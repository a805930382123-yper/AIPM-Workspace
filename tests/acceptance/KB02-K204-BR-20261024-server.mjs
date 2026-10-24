import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import express from 'express';
import {RawStore} from '../../services/raw/store.ts';
import {RawStateStore} from '../../services/raw/state.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {WikiCommitService} from '../../services/wiki/commits.ts';
import {registerB04Routes} from '../../server/llm-api.ts';
import {registerKnowledgeRoutes} from '../../server/knowledge-api.ts';
import {registerRecoveryRoutes} from '../../server/recovery-api.ts';
import {RecoveryRegistry} from '../../services/storage/recovery.ts';
import {getStats} from '../../services/stats/index.ts';
import {guardNetwork} from './KB02-K204-PREP-20261023-support.mjs';

export const P='docs/reports/KB02-K204-BR-20261024-',ROOT=path.resolve('.'),ORIGINAL=path.join(ROOT,'.scratch-KB02-K204-B-20261024-J5hCNy');
export const CARD='docs/handoffs/KB02-K204-BR-20261024-task.md',CARD_SHA='a5116f4081abaf1ba927b59d10b4111cf684a6276c29784b1e60128ada4a4bbe';
export const ID={session:'0fb85966-323f-4cd8-a68e-040c8b573aa2',raw:'3942d90b-0d66-4196-82bb-0acfdd14904a',draft:'4c2d4689-7827-4bec-a9d2-92517f12e3f4',job:'0299575f-963f-4bc3-b5c0-f281034d6e84',body:'d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515'};
export const INITIAL={'session.json':'ef7313fc77045268a2282ec9565be61b216c08e1d8f9657f4c3b1ed1cbcca06e','session-marker.json':'9358aea330d04c3316aa6fa48b14ae3ab7e55fa3af1efdd0725c9e27da18d1bc','attempts.jsonl':'7b743ab847ac9378fb02efcb71ca60563b4ffce069fd6ac72818de5e7921337c','candidate-B.json':'08217d6d809edbf5143ebae1d3be54c4423321c7fb3b67db22c3fa208b2a7882',[`drafts/${ID.draft}.json`]:'08217d6d809edbf5143ebae1d3be54c4423321c7fb3b67db22c3fa208b2a7882'};
export const sha=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
export const readJson=async f=>JSON.parse(await fs.readFile(f,'utf8'));
export class RepairError extends Error{constructor(code){super(code);this.code=code;this.status=409;}}
export const must=(x,c)=>{if(!x)throw new RepairError(c);};
export async function save(file,value,exclusive=false){const h=await fs.open(file,exclusive?'wx':'w',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}}
async function atomic(file,value){const temp=file+'.'+randomUUID()+'.tmp';await save(temp,value,true);for(let i=0;;i++){try{await fs.rename(temp,file);return;}catch(e){if(i>=5||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,20*(i+1)));}}}
export async function snapshot(root){const out=[];async function walk(dir){for(const d of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,d.name);must(!d.isSymbolicLink(),'SYMLINK_DENIED');if(d.isDirectory())await walk(f);else out.push({path:path.relative(root,f).split(path.sep).join('/'),sha256:sha(await fs.readFile(f))});}}await walk(root);return out.sort((a,b)=>a.path.localeCompare(b.path));}
const mutable=f=>f===`drafts/${ID.draft}.json`||f===`state/raw-processing/${ID.raw}.json`||f.startsWith('knowledge/wiki/')||f==='knowledge/logs/wiki.jsonl'||f.startsWith('state/wiki-commits/')||f.startsWith('state/wiki-operations/');
export async function verifySources(){must(sha(await fs.readFile(CARD))===CARD_SHA,'BR_CARD_DRIFT');must(sha(await fs.readFile('docs/reports/KB02-K204-B-20261024-freeze.json'))==='12dad741181e7e74a95d58d2f49a24774343c6f11903b1083d7bbb4d4f6f2463','B_FREEZE_DRIFT');const file=P+'freeze.json',freeze=await readJson(file);for(const x of freeze.files)must(sha(await fs.readFile(x.path))===x.sha256,'SOURCE_FREEZE_DRIFT');return sha(await fs.readFile(file));}
export async function inspect(root=ORIGINAL,{testCopy=false,control}={}){
  root=path.resolve(root);must(root===ORIGINAL||(testCopy&&path.dirname(root)===ROOT&&path.basename(root).startsWith('.scratch-KB02-K204-BR-20261024-copy-')),'ROOT_BINDING_DENIED');
  const session=await readJson(path.join(root,'session.json')),marker=await readJson(path.join(root,'session-marker.json'));must(session.id===ID.session&&session.root===ORIGINAL&&marker.id===ID.session&&session.stages.B.draftId===ID.draft&&session.stages.B.status==='awaiting_review','SESSION_BINDING_DRIFT');
  for(const [f,h]of Object.entries(INITIAL))if(!f.startsWith('drafts/')||!control)must(sha(await fs.readFile(path.join(root,f)))===h,'INITIAL_BINDING_DRIFT');
  const rows=(await fs.readFile(path.join(root,'attempts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);must(JSON.stringify(rows.map(x=>x.sequence))==='[225,226]','LEDGER_BINDING_DRIFT');
  const raw=await new RawStore(root).get(ID.raw);must(raw&&sha(raw.body)===ID.body,'RAW_BINDING_DRIFT');const draft=await readJson(path.join(root,'drafts',ID.draft+'.json'));must(draft.rawId===ID.raw&&draft.id===ID.draft,'DRAFT_BINDING_DRIFT');
  const files=await snapshot(root);if(!testCopy&&!control)must(files.length===16&&!files.some(f=>f.path.startsWith('state/wiki-commits/')||(f.path.startsWith('knowledge/wiki/')&&f.path!=='knowledge/wiki/index.md')),'INITIAL_BUSINESS_STATE_DRIFT');if(control)must(JSON.stringify(files)===JSON.stringify(control.files),'CONTROLLED_FILES_DRIFT');return {root,sessionId:session.id,rawId:ID.raw,draftId:draft.id,draftRevision:draft.revision,draftStatus:draft.status,files,modelCalls:0,configReads:0};
}

export async function createLab({root=ORIGINAL,sidecar,testCopy=false}={}){
  root=path.resolve(root);const freezeSha=await verifySources();must(sidecar&&path.dirname(path.resolve(sidecar))===ROOT&&path.basename(sidecar).startsWith('.scratch-KB02-K204-BR-20261024-control-'),'SIDECAR_REQUIRED');sidecar=path.resolve(sidecar);
  const stateFile=path.join(sidecar,'control.json'),lease=path.join(sidecar,'server.lock');let state,held=false,server,network,busy=false;
  try{
    try{const prior=await readJson(lease);try{process.kill(prior.pid,0);throw new RepairError('SERVER_ALREADY_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(lease);}catch(e){if(e.code!=='ENOENT')throw e;}
    await save(lease,{pid:process.pid,root},true);held=true;
    try{state=await readJson(stateFile);must(state.root===root&&state.cardSha256===CARD_SHA&&state.freezeSha256===freezeSha,'CONTROL_BINDING_DRIFT');}catch(e){if(e.code!=='ENOENT')throw e;}
    const initial=await inspect(root,{testCopy,control:state});if(!state){state={root,sessionId:ID.session,cardSha256:CARD_SHA,freezeSha256:freezeSha,files:initial.files,draftRevision:initial.draftRevision,mutations:[]};await save(stateFile,state,true);}
    const raws=new RawStore(root),rawStates=new RawStateStore(root),drafts=new DraftStore(root),wiki=new WikiStore(root,raws);for(const store of [raws,rawStates,drafts])await store.initialize();
    // No WikiStore.initialize/reconcile: reopening never repairs or commits stored work.
    const commits=new WikiCommitService({root,wikiStore:wiki,drafts,rawStates,rawStore:raws});await commits.initialize();
    const statistics={modelCalls:0,configReads:0,providerCallbacks:0,modelRoutesDenied:0,requests:[]};const denyModel=()=>{statistics.providerCallbacks++;throw new RepairError('MODEL_PERMANENTLY_DISABLED');};
    const runner={recoveryJobs:()=>[],readJob:async id=>{must(id===ID.job,'JOB_BINDING_DENIED');return readJson(path.join(root,'state','extraction-jobs',id+'.json'));},start:denyModel,cancel:denyModel,reconcileStorage:denyModel};
    const jobs={get:runner.readJob};const app=express();app.use(express.json({limit:'3mb'}));
    app.use(async(req,res,next)=>{try{
      const p=req.path,isApi=p.startsWith('/api/');if(!isApi)return next();
      if(/\/raw\/.+\/extract$|\/llm|\/prompt|\/meeting|\/audits\/.+|\/knowledge\/(?:updates|syntheses)|\/extraction-jobs\/.+\//.test(p)){statistics.modelRoutesDenied++;throw new RepairError('MODEL_PERMANENTLY_DISABLED');}
      const fixedDraft=`/api/drafts/${ID.draft}`,knowledge=`/api/knowledge/drafts/${ID.draft}/pages/`;
      if((p.startsWith('/api/drafts/')&&!p.startsWith(fixedDraft))||(p.startsWith('/api/knowledge/drafts/')&&!p.startsWith(knowledge)))throw new RepairError('DRAFT_BINDING_DENIED');
      const write=!['GET','HEAD'].includes(req.method),decision=req.method==='PATCH'&&p.startsWith(knowledge)&&/^.+\/decision$/.test(p),allowed=decision||(req.method==='PATCH'&&p===fixedDraft)||(req.method==='POST'&&(p===fixedDraft+'/confirm'||p===fixedDraft+'/review/start'||p===fixedDraft+'/review/move'||p.startsWith(fixedDraft+'/review/pages/')));
      if(write&&!allowed)throw new RepairError('OUT_OF_SCOPE_ROUTE');if(decision)must(['create','defer'].includes(req.body?.decision),'UPDATE_DECISION_DISABLED');
      must(!busy,'LOCAL_MUTATION_BUSY');await inspect(root,{testCopy,control:state});statistics.requests.push({method:req.method,path:p});
      if(write){busy=true;const originalJson=res.json.bind(res);res.json=value=>{void(async()=>{const files=await snapshot(root),before=new Map(state.files.map(x=>[x.path,x.sha256])),after=new Map(files.map(x=>[x.path,x.sha256])),changed=[...new Set([...before.keys(),...after.keys()])].filter(f=>before.get(f)!==after.get(f));must(changed.every(mutable),'PROTECTED_FILE_MUTATION');const current=await readJson(path.join(root,'drafts',ID.draft+'.json'));state={...state,files,draftRevision:current.revision,mutations:[...state.mutations,{at:new Date().toISOString(),method:req.method,path:p,httpStatus:res.statusCode,changed,draftRevision:current.revision}]};await atomic(stateFile,state);busy=false;originalJson(value);})().catch(error=>{busy=false;res.status(500);originalJson({error:{code:error.code??'CONTROL_CHECKPOINT_FAILED',message:'本地恢复状态未能记录；停止操作。'}});});return res;};}
      next();
    }catch(e){next(e);}});
    app.get('/api/health',(_q,r)=>r.json({ok:true,isolated:true,modelDisabled:true}));registerRecoveryRoutes(app,new RecoveryRegistry(root));
    app.get('/api/stats',async(_q,r,n)=>{try{r.json(await getStats(root,raws,new Date()));}catch(e){n(e);}});
    app.get('/api/raw',async(_q,r,n)=>{try{r.json({items:await raws.list()});}catch(e){n(e);}});
    app.get('/api/raw/:id',async(q,r,n)=>{try{must(q.params.id===ID.raw,'RAW_BINDING_DENIED');r.json(await raws.get(ID.raw));}catch(e){n(e);}});
    app.get('/api/raw/:id/references',async(q,r,n)=>{try{must(q.params.id===ID.raw,'RAW_BINDING_DENIED');r.json({items:await wiki.referencesToRaw(ID.raw)});}catch(e){n(e);}});
    app.get('/api/wiki/schema',async(_q,r,n)=>{try{r.json(await wiki.schema());}catch(e){n(e);}});
    app.get('/api/wiki',async(q,r,n)=>{try{r.json({items:await wiki.list({q:q.query.q,category:q.query.category}),categoryCounts:await wiki.categoryCounts()});}catch(e){n(e);}});
    app.get('/api/wiki/:id/export',async(q,r,n)=>{try{const w=await wiki.exportMarkdown(q.params.id);must(w,'WIKI_NOT_FOUND');r.type('text/markdown').send(w.markdown);}catch(e){n(e);}});
    app.get('/api/wiki/:id/references',async(q,r,n)=>{try{r.json({items:await wiki.references(q.params.id)});}catch(e){n(e);}});
    app.get('/api/wiki/:id',async(q,r,n)=>{try{const w=await wiki.get(q.params.id);must(w,'WIKI_NOT_FOUND');r.json({...w,links:(await wiki.links(w.id)).map(x=>({target:x.text,status:x.status==='found'?'resolved':x.status,candidates:x.candidates}))});}catch(e){n(e);}});
    app.get('/api/audits',(_q,r)=>r.json({items:[]}));
    registerB04Routes(app,{root,rulesDir:'rules',provider:denyModel,llm:{wikiExtract:denyModel},runner,jobs,drafts,commits,rawStates,rawStore:raws,wikiStore:wiki});
    registerKnowledgeRoutes(app,{root,raws,drafts,wiki,provider:denyModel});
    const status=()=>({root,sessionId:ID.session,draftId:ID.draft,draftRevision:state.draftRevision,sidecar,freezeSha256:freezeSha,modelDisabled:true,...statistics});
    app.get('/__repair/status',(_q,r)=>r.json(status()));
    app.get('/__repair/export',async(_q,r,n)=>{try{await inspect(root,{testCopy,control:state});const result={...status(),mutations:state.mutations,raw:await raws.get(ID.raw),draft:await drafts.get(ID.draft),wiki:await wiki.allRecords(),immutableArtifacts:state.files.filter(f=>!mutable(f.path))};const file=P+'export-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';await save(file,result,true);r.json({path:file,sha256:sha(await fs.readFile(file)),privateResponsesExcluded:true,configurationExcluded:true});}catch(e){n(e);}});
    app.post('/__repair/shutdown',(_q,r)=>{r.json({closing:true});setImmediate(()=>lab.close());});
    app.use((e,_q,r,_n)=>r.status(e.status??500).json({error:{code:e.code??'LOCAL_REPAIR_FAILED',message:e.code??'本地修复接线失败，停止操作。'}}));
    network=guardNetwork();server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});const base=`http://127.0.0.1:${server.address().port}`;network.allow(base);
    await inspect(root,{testCopy,control:state});let closed=false;const lab={root,sidecar,base,raws,drafts,wiki,commits,statistics,network,status,async close(){if(closed)return;must(!busy,'LOCAL_MUTATION_BUSY');closed=true;await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));network.restore();await fs.unlink(lease);held=false;}};return lab;
  }catch(e){if(server?.listening)await new Promise(r=>server.close(r));network?.restore();if(held)await fs.unlink(lease);throw e;}
}
