import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {RawStore} from '../../services/raw/store.ts';
import {RawStateStore} from '../../services/raw/state.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {WikiCommitService} from '../../services/wiki/commits.ts';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
import {ExtractionRunner,ExtractionJobStore} from '../../services/llm/jobs.ts';
import {LLMService} from '../../services/llm/service.ts';
import {loadExtractionRules} from '../../services/llm/rules.ts';
import {registerB04Routes} from '../../server/llm-api.ts';
import {registerKnowledgeRoutes} from '../../server/knowledge-api.ts';
import {registerRecoveryRoutes} from '../../server/recovery-api.ts';
import {RecoveryRegistry} from '../../services/storage/recovery.ts';
import {validateBaseRevision,validateWikiInput} from '../../server/wiki-validation.ts';
import {getStats} from '../../services/stats/index.ts';
import {Engine,CAPS,P,must,sha,readJson,durable,atomic,GateError,sessionFrom,scan} from './KB02-K204-A-20261023-core.mjs';

export async function createLab(options){
  const engine=new Engine(options),session=await sessionFrom(options.manifestFile),root=session.root,lease=path.join(root,'server.lock');let leaseHeld=false,server;
  try{
    try{const prior=await readJson(lease);try{process.kill(prior.pid,0);throw new GateError('SERVER_ALREADY_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(lease);}catch(e){if(e.code!=='ENOENT')throw e;}
    await durable(lease,{pid:process.pid,sessionId:session.id},{exclusive:true});leaseHeld=true;await engine.initialize();
    const raws=new RawStore(root),rawStates=new RawStateStore(root),drafts=new DraftStore(root),wiki=new WikiStore(root,raws),jobs=new ExtractionJobStore(root),llm=new LLMService('rules');
    for(const store of [raws,rawStates,drafts,wiki,jobs])await store.initialize();
    const commits=new WikiCommitService({root,wikiStore:wiki,drafts,rawStates,rawStore:raws});await commits.initialize();const workflows=new KnowledgeWorkflowStore(root,wiki,raws);await workflows.initialize();let provider;
    const rules=await loadExtractionRules('rules'),draftRules=async()=>({types:rules.fmcg.types.map(t=>t.id),categories:rules.fmcg.categories.map(t=>t.id),...rules.fmcg.enums});
    const runner=new ExtractionRunner({root,jobs,drafts,rawStates,rawStore:raws,rulesDir:'rules',llm,provider:()=>provider,draftRules});
    await runner.reconcile();await commits.reconcile();
    for(const stage of ['A1','A2'])if(!session.samples[stage].rawId){const sample=session.samples[stage],raw=await raws.create({title:'K204-A '+sample.id,sourceType:'report',sourceName:'本轮固定虚构资料',tags:['KB02'],body:sample.body});await engine.update(s=>{s.samples[stage].rawId=raw.id;});}
    async function targetBinding(id){const current=await engine.load(),target=await wiki.get(id);must(target&&target.type==='metric'&&target.sources.includes(current.samples.A1.rawId),'A1_METRIC_TARGET_REQUIRED');must(target.body.includes((await readJson('docs/reports/KB02-K204-PREP-AUDIT-20261023-spec.json')).humanMemo),'A1_MEMO_REQUIRED');const a1=current.stages.A1,initial=await readJson(path.join(root,'candidate-A1.json')),draft=await drafts.get(a1.draftId);must(draft?.status==='confirmed','A1_CONFIRMATION_REQUIRED');
      const manifests=await fs.readdir(path.join(root,'state','wiki-commits'));let valid=false;for(const file of manifests){if(!file.endsWith('.json'))continue;const m=await readJson(path.join(root,'state','wiki-commits',file));const index=m.snapshot?.pageRecords?.findIndex(p=>p.id===id)??-1;if(m.status==='completed'&&m.draftId===draft.id&&index>=0){const pageId=m.snapshot.selectedPageIds[index];valid=initial.pages.some(p=>p.pageId===pageId&&p.type==='metric');}}
      must(valid,'TARGET_NOT_FROM_ORIGINAL_A1_METRIC');return {id:target.id,revision:target.revision,bodySha256:sha(target.body)};
    }
    engine.bindingReader=async(stage,hints={})=>{const s=await engine.load();must(Object.hasOwn(CAPS,stage),'STAGE_A_ONLY');const sample=s.samples[stage==='A3'?'A2':stage],raw=await raws.get(sample.rawId);must(raw&&sha(raw.body)===sample.bodySha256,'RAW_BINDING_DRIFT');const base={rawId:raw.id,rawSha256:sample.bodySha256};if(stage==='A1')return base;
      const target=await targetBinding(hints.target?.id??s.target?.id);if(stage==='A2')return {...base,target};must(s.target&&JSON.stringify(target)===JSON.stringify(s.target),'A1_TARGET_DRIFT');const draft=await drafts.get(s.stages.A2.draftId);must(draft,'A2_INPUT_REQUIRED');const digest=await drafts.assertReviewed(draft,raw.body),page=draft.pages.find(p=>p.pageId===hints.pageId);must(page&&page.reviewDecision==='update'&&page.updateTargetWikiId===target.id,'A3_DECISION_REQUIRED');return {...base,target,draftId:draft.id,revision:draft.revision,reviewContentDigest:digest,approvalSha256:sha(draft.humanReview.approvals),pageId:page.pageId};
    };
    engine.snapshotReader=async stage=>{const s=await engine.load(),sample=s.samples[stage==='A3'?'A2':stage],jobId=s.stages[stage]?.jobId;return {raw:await raws.get(sample.rawId),job:jobId?await jobs.get(jobId):null,checkpoint:jobId?await readJson(path.join(root,'state','extraction-checkpoints',jobId+'.json')):null,inputDraft:stage==='A3'?await drafts.get(s.stages.A2.draftId):null,target:stage==='A3'?await wiki.get(s.target.id):null};};
    const originalStart=runner.start.bind(runner);runner.start=async(rawId,opts)=>{const s=await engine.load(),stage=s.activeStage;must(['A1','A2'].includes(stage)&&rawId===s.samples[stage].rawId,'WRONG_EXTRACTION_INPUT');await engine.update(x=>{must(!x.stages[stage].jobId,'DUPLICATE_JOB');x.stages[stage].jobId=opts.newJobId;});const started=await originalStart(rawId,opts);
      void(async()=>{try{await runner.waitForSettlement(started.job.id);const job=await jobs.get(started.job.id);if(job.status!=='completed'){await engine.stop(job.error?.code??'PRODUCT_EXTRACTION_FAILED',stage);return;}const d=await drafts.get(job.draftId);await durable(path.join(root,'candidate-'+stage+'.json'),d,{exclusive:true});await engine.finish(stage,{jobId:job.id,draftId:d.id,candidateSha256:sha(d)});}catch(error){await engine.stop(error.code??'SETTLEMENT_CAPTURE_FAILED',stage);}})();return started;};
    const app=express();app.use(express.json({limit:'3mb'}));app.use(async(req,res,next)=>{try{
      const extract=req.method==='POST'&&/^\/api\/raw\/[^/]+\/extract$/.test(req.path),update=req.method==='POST'&&req.path==='/api/knowledge/updates';
      if(extract||update){const s=await engine.load(),stage=update?'A3':req.params?.id;let selected=update?'A3':Object.keys(s.samples).find(x=>req.path===`/api/raw/${s.samples[x].rawId}/extract`);must(selected&&selected===s.activeStage,'UNRELEASED_AI_ROUTE');if(extract)must(req.body&&Object.keys(req.body).length===0,'NO_RESTART_OR_RETRY');else{const {r}=await engine.release();must(req.body?.draftId===r.bindings.draftId&&req.body?.pageId===r.bindings.pageId&&req.body?.targetWikiId===r.bindings.target.id&&req.body?.baseRevision===r.bindings.revision,'WRONG_A3_INPUT');}
        await engine.begin(selected);req.ownedStage=selected;provider=await engine.provider();if(update)res.once('finish',()=>{void(async()=>{if(res.statusCode>=400){await engine.stop('PRODUCT_UPDATE_FAILED','A3');return;}const list=(await workflows.list()).filter(w=>w.kind==='update');must(list.length===1,'UNIQUE_UPDATE_REQUIRED');const w=list[0];await durable(path.join(root,'candidate-A3.json'),w,{exclusive:true});await engine.finish('A3',{workflowId:w.id,candidateSha256:sha(w)});})().catch(()=>engine.stop('UPDATE_CAPTURE_FAILED','A3'));});
      }
      const allowedWrite=req.method==='POST'&&(/^\/api\/drafts\/[^/]+\/review\//.test(req.path)||/^\/api\/drafts\/[^/]+\/confirm$/.test(req.path)||/^\/api\/knowledge\/workflows\/[^/]+\/(?:review\/|confirm)/.test(req.path)||req.path.startsWith('/api/extraction-jobs/'));
      if(!['GET','HEAD'].includes(req.method)&&req.path.startsWith('/api/')&&!extract&&!update&&!allowedWrite&&!(req.method==='PATCH'&&(/^\/api\/drafts\/[^/]+$/.test(req.path)||/^\/api\/knowledge\/(?:drafts\/[^/]+\/pages\/[^/]+\/decision|workflows\/[^/]+)$/.test(req.path)))&&!(req.method==='PUT'&&/^\/api\/wiki\/[^/]+$/.test(req.path)))throw new GateError('OUT_OF_SCOPE_ROUTE');
      next();
    }catch(error){if(req.ownedStage)await engine.stop(error.code??'AI_ROUTE_FAILED',req.ownedStage);next(error);}});
    app.get('/api/health',(_q,r)=>r.json({ok:true,isolated:true}));registerRecoveryRoutes(app,new RecoveryRegistry(root));
    app.get('/api/stats',async(_q,r,n)=>{try{r.json(await getStats(root,raws,new Date()));}catch(e){n(e);}});
    app.get('/api/raw',async(_q,r,n)=>{try{r.json({items:await raws.list()});}catch(e){n(e);}});
    app.get('/api/raw/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.referencesToRaw(q.params.id)});}catch(e){n(e);}});
    app.get('/api/raw/:id',async(q,r,n)=>{try{const raw=await raws.get(q.params.id);must(raw,'RAW_NOT_FOUND');r.json(raw);}catch(e){n(e);}});
    app.get('/api/wiki/schema',async(_q,r,n)=>{try{r.json(await wiki.schema());}catch(e){n(e);}});
    app.get('/api/wiki',async(q,r,n)=>{try{r.json({items:await wiki.list({q:q.query.q,category:q.query.category}),categoryCounts:await wiki.categoryCounts()});}catch(e){n(e);}});
    app.get('/api/wiki/:id/export',async(q,r,n)=>{try{const result=await wiki.exportMarkdown(q.params.id);must(result,'WIKI_NOT_FOUND');r.type('text/markdown').send(result.markdown);}catch(e){n(e);}});
    app.get('/api/wiki/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.references(q.params.id)});}catch(e){n(e);}});
    app.get('/api/wiki/:id',async(q,r,n)=>{try{const w=await wiki.get(q.params.id);must(w,'WIKI_NOT_FOUND');const links=(await wiki.links(w.id)).map(x=>({target:x.text,status:x.status==='found'?'resolved':x.status,candidates:x.candidates}));r.json({...w,links});}catch(e){n(e);}});
    app.put('/api/wiki/:id',async(q,r,n)=>{try{const previous=await wiki.get(q.params.id),s=await engine.load();must(previous&&previous.sources.includes(s.samples.A1.rawId),'A1_TARGET_ONLY');const input=validateWikiInput(q.body);must(input.type===previous.type&&JSON.stringify(input.sources)===JSON.stringify(previous.sources),'TARGET_IDENTITY_IMMUTABLE');r.json(await wiki.update(previous.id,validateBaseRevision(q.body.baseRevision),input));}catch(e){n(e);}});
    // Wiki detail loads audits read-only. No AI audit route is registered.
    app.get('/api/audits',async(_q,r)=>r.json({items:[]}));
    registerB04Routes(app,{root,provider:()=>provider,rulesDir:'rules',llm,runner,jobs,drafts,commits,rawStates,rawStore:raws,wikiStore:wiki});
    registerKnowledgeRoutes(app,{root,raws,drafts,wiki,provider:()=>provider});
    app.get('/__stage/status',async(_q,r,n)=>{try{const s=await engine.load();r.json({sessionId:s.id,mode:s.mode,root:s.root,activeStage:s.activeStage,stopped:s.stopped,stopCode:s.stopCode,stages:s.stages,samples:Object.fromEntries(Object.entries(s.samples).map(([k,x])=>[k,{rawId:x.rawId,bodySha256:x.bodySha256}])),target:s.target,attempts:await engine.attempts(),configReads:engine.configReads,sentThisProcess:engine.sent,safeProvider:s.safeProvider});}catch(e){n(e);}});
    app.get('/__stage/bindings',async(q,r,n)=>{try{r.json(await engine.bindings(String(q.query.stage),{target:{id:q.query.targetId},pageId:q.query.pageId}));}catch(e){n(e);}});
    app.post('/__stage/arm',async(q,r,n)=>{try{r.json(await engine.arm(q.body.stage,q.body.releaseFile,q.body.exactSha256));}catch(e){n(e);}});
    app.get('/__stage/export',async(_q,r,n)=>{try{const s=await engine.load();must(engine.mode==='fake'||engine.lastSecrets,'EXPORT_REQUIRES_CURRENT_SECRET_SCAN_CONTEXT');const evidence={sessionId:s.id,mode:s.mode,stages:s.stages,attempts:await engine.attempts(),raws:await raws.list(),drafts:await drafts.list(),workflows:await workflows.list(),wiki:await wiki.allRecords(),safeProvider:s.safeProvider,artifacts:[]};for(const name of await fs.readdir(root))if(/^(?:request-|result-|candidate-).+\.json$/.test(name))evidence.artifacts.push({name,value:await readJson(path.join(root,name))});scan(evidence,engine.lastSecrets??[]);const file=P+'export-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';await durable(file,evidence,{exclusive:true});r.json({path:file,sha256:sha(await fs.readFile(file)),privateResponsesExcluded:true});}catch(e){n(e);}});
    app.post('/__stage/shutdown',(_q,r)=>{r.json({closing:true});setImmediate(()=>lab.close());});
    app.use(async(error,req,res,_next)=>{if(req.ownedStage)await engine.stop(error.code??'AI_ROUTE_FAILED',req.ownedStage).catch(()=>{});res.status(error.status??500).json({error:{code:error.code??'LOCAL_ADAPTER_ERROR',message:error.code??'本地接线失败；审查私有状态。'}});});
    engine.installNetwork();server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});const base=`http://127.0.0.1:${server.address().port}`;engine.localOrigins.add(base);
    let closed=false;const lab={engine,root,base,raws,rawStates,drafts,wiki,commits,workflows,runner,jobs,async close(){if(closed)return;closed=true;const current=await engine.load();if(current.activeStage&&current.stages[current.activeStage].status==='running'){await engine.stop('SERVER_SHUTDOWN_IN_FLIGHT',current.activeStage);const id=current.stages[current.activeStage].jobId;if(id)await runner.cancel(id);}for(const x of Object.values((await engine.load()).stages))if(x.jobId)await runner.waitForSettlement(x.jobId);await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));engine.restoreNetwork();await fs.unlink(lease);leaseHeld=false;}};return lab;
  }catch(error){if(server?.listening)await new Promise(r=>server.close(r));engine.restoreNetwork?.();if(leaseHeld)await fs.unlink(lease);throw error;}
}
