// R22's bounded real evidence capture. prepare/smoke never load real configuration.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RawStore } from '../../services/raw/store.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../../services/wiki/knowledge-workflows.ts';
import { ExtractionCheckpointStore } from '../../services/llm/checkpoints.ts';
import { runKnowledgePipeline } from '../../services/llm/knowledge-extraction.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { assertNoKnownSecret } from '../../services/llm/provider.ts';

const PREFIX = '.scratch-R22-REAL-20261029-';
const SCRIPT = 'tests/acceptance/R22-20261029-real.mjs';
const CARD = 'docs/handoffs/R22-20261029-task.md';
const FIXTURES = [
  { title: 'OpenAI官方文档：Structured Outputs', sourceType: 'article', sourceName: 'OpenAI官方开发文档', author: 'OpenAI', url: 'https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat', body: 'Structured Outputs is a feature that ensures the model will always generate responses that adhere to your supplied JSON Schema', tags: ['R22验收','公开原文摘录'] },
  { title: 'Structured Outputs 本地业务影响待确认', sourceType: 'note', sourceName: '来源未知', body: '该特性对本地业务的成本影响尚未确认。', tags: ['R22验收'] },
];
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file,'utf8'));
const must = (ok, code) => { if (!ok) throw Object.assign(new Error(code),{code}); };
const exists = file => fs.access(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
async function durable(file,value) { const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();} }
async function freeze() {
  const files=[];
  async function walk(dir) {for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())files.push({path:file.replaceAll('\\','/'),sha256:sha(await fs.readFile(file))});}}
  for(const dir of ['services','server','app','rules'])await walk(dir);
  for(const file of [SCRIPT,CARD,'package.json','package-lock.json'])files.push({path:file,sha256:sha(await fs.readFile(file))});
  files.sort((a,b)=>a.path.localeCompare(b.path));return {files,sha256:sha(files)};
}
function releaseTemplate(session,stage) {
  return { released:false,budgetApproved:false,issuedBy:'main',issuedAt:null,sessionId:session.id,mode:session.mode,stage,maxCalls:stage==='extract'?2:1,sequences:stage==='extract'?[259,260]:[261],rawBindings:session.rawBindings,freezeSha256:session.freezeSha256,...(stage==='synthesis'?{independentExtractPass:false,extractCandidateSha256:null}:{}) };
}
export async function prepare(mode='real') {
  must(['real','fake'].includes(mode),'MODE_INVALID');
  const root=await fs.mkdtemp(path.resolve(PREFIX)),raws=new RawStore(root);await raws.initialize();
  const created=[];for(const fixture of FIXTURES)created.push(await raws.create(fixture));
  const rawBindings=[];
  for(const raw of created)rawBindings.push({id:raw.id,bodySha256:raw.bodySha256,fileSha256:sha(await fs.readFile(path.join(root,'knowledge/raw',raw.sourceType==='article'?'articles':'notes',raw.id+'.md')))});
  const frozen=await freeze();await durable(path.join(root,'freeze.json'),frozen);
  const session={id:randomUUID(),root,mode,rawBindings,freezeSha256:frozen.sha256,knowledgeBefore:258,promptUsed:15,maxCalls:3,sequences:[259,260,261],expected:{extractSourceLevel:'A',unknownSourceLevel:'D',synthesisInitialLevel:'D'}};
  await durable(path.join(root,'session.json'),session);
  return {session,extractReleaseTemplate:releaseTemplate(session,'extract'),synthesisReleaseTemplate:releaseTemplate(session,'synthesis')};
}
async function sessionAt(root) {
  root=path.resolve(root);must(path.dirname(root)===process.cwd()&&path.basename(root).startsWith(PREFIX),'ISOLATED_ROOT_REQUIRED');
  const s=await read(path.join(root,'session.json'));must(s.root===root&&['real','fake'].includes(s.mode)&&s.knowledgeBefore===258&&s.maxCalls===3&&JSON.stringify(s.sequences)==='[259,260,261]','SESSION_INVALID');return s;
}
async function releaseFor(s,stage,file,hash) {
  must(['extract','synthesis'].includes(stage),'STAGE_INVALID');must(file&&hash,'RELEASE_REQUIRED');
  const bytes=await fs.readFile(file);must(sha(bytes)===hash,'RELEASE_SHA_DRIFT');const release=JSON.parse(bytes);
  must(release.released===true&&release.budgetApproved===true&&release.issuedBy==='main'&&Number.isFinite(Date.parse(release.issuedAt)),'RELEASE_NOT_APPROVED');
  for(const [key,value] of Object.entries({sessionId:s.id,mode:s.mode,stage,rawBindings:s.rawBindings,freezeSha256:s.freezeSha256,maxCalls:stage==='extract'?2:1,sequences:stage==='extract'?[259,260]:[261]}))must(JSON.stringify(release[key])===JSON.stringify(value),'RELEASE_BINDING_DRIFT');
  must((await freeze()).sha256===s.freezeSha256,'SOURCE_FREEZE_DRIFT');
  if(stage==='synthesis') {
    const result=await read(path.join(s.root,'extract-result.json'));
    must(result.status==='captured-awaiting-independent-review'&&release.independentExtractPass===true,'EXTRACT_REVIEW_REQUIRED');
    must(release.extractCandidateSha256===sha(await fs.readFile(path.join(s.root,'extract-candidate.json'))),'EXTRACT_CANDIDATE_BINDING_DRIFT');
  }
}
function fakeReply(request,index) {
  const input=JSON.parse(request.user.split('\n').at(-1));let value;
  if(index===0)value={version:2,facts:input.map(atom=>({atomId:atom.id,kind:'fact'})),questions:[],sourceNotes:[]};
  else if(index===1)value={version:3,document:{title:FIXTURES[0].title,main_topic:'渠道覆盖',source_level:'A'},pages:[{title:'R22虚构渠道覆盖',type:'metric',category:'metric',factUnitIds:input.factUnits.map(unit=>unit.id),questionUnitIds:input.questionUnits.map(unit=>unit.id)}]};
  else value={synthesis_format_version:1,title:'R22虚构甲渠道综合',category:'metric',sourceLevels:input.raws.map((raw,i)=>({rawId:raw.id,source_level:i===0?'A':'D'})),suggestedAdditions:input.raws.map(raw=>({text:raw.body,rawId:raw.id,locatorId:raw.locators[0].id})),agreement:[],conflicts:[],inferences:[],openQuestions:[]};
  return {text:JSON.stringify(value),bytes:1,finishReason:'stop'};
}
export async function run(root,stage,releaseFile,releaseSha,fakeFailure=false) {
  const s=await sessionAt(root);await releaseFor(s,stage,releaseFile,releaseSha);must(!fakeFailure||s.mode==='fake','FAKE_MODE_REQUIRED');
  must(!(await exists(path.join(s.root,stage+'-started.json'))),'STAGE_ALREADY_STARTED');
  if(stage==='extract')must(!(await exists(path.join(s.root,'synthesis-started.json'))),'REQUEST_ORDER_INVALID');
  const raws=new RawStore(s.root),drafts=new DraftStore(s.root),states=new RawStateStore(s.root),checkpoints=new ExtractionCheckpointStore(s.root),wiki=new WikiStore(s.root,raws);
  await Promise.all([raws.initialize(),drafts.initialize(),states.initialize(),checkpoints.initialize(),wiki.initialize()]);
  const entries=await Promise.all(s.rawBindings.map(binding=>raws.get(binding.id)));
  for(let i=0;i<entries.length;i++){const raw=entries[i],binding=s.rawBindings[i];must(raw&&raw.body===FIXTURES[i].body&&raw.title===FIXTURES[i].title&&raw.sourceName===FIXTURES[i].sourceName&&raw.bodySha256===binding.bodySha256,'RAW_BINDING_DRIFT');must(sha(await fs.readFile(path.join(s.root,'knowledge/raw',raw.sourceType==='article'?'articles':'notes',raw.id+'.md')))===binding.fileSha256,'RAW_FILE_DRIFT');}
  await durable(path.join(s.root,stage+'-started.json'),{sessionId:s.id,stage,releaseSha,at:new Date().toISOString()});
  let reserved=0,sent=0,configReads=0,actual,secrets=[],checkpoint;const sequences=stage==='extract'?[259,260]:[261];
  const provider={name:s.mode==='fake'?'synthetic-engineering':'openai-compatible',model:s.mode==='fake'?'r22-fixture':'gpt-6.1-terra',get secrets(){return secrets;},async complete(request){
    must(reserved<sequences.length&&request.purpose==='knowledge','REQUEST_LIMIT');await releaseFor(s,stage,releaseFile,releaseSha);
    const isPlanning=request.user.startsWith('请对下列全部已验证事实规划知识页');must(stage==='synthesis'||isPlanning===(reserved===1),'REQUEST_ORDER_INVALID');
    const sequence=sequences[reserved],safeRequest={system:request.system,user:request.user,purpose:request.purpose,structuredOutput:request.structuredOutput,timeoutMs:request.timeoutMs,maxOutputBytes:request.maxOutputBytes};
    await durable(path.join(s.root,`attempt-${sequence}.json`),{sequence,stage,sessionId:s.id,requestSha256:sha(safeRequest),at:new Date().toISOString(),status:'reserved-counts-if-unknown'});reserved++;
    let response;
    if(s.mode==='real') {
      if(!actual){configReads++;const {loadLlmConfig}=await import('../../services/llm/config.ts');const {OpenAiCompatibleProvider}=await import('../../services/llm/provider.ts');const config=await loadLlmConfig({filePath:path.resolve('.env.local')});must(new URL(config.baseUrl).hostname.toLowerCase()==='api.openai.com'&&config.model==='gpt-6.1-terra','PROVIDER_BINDING_DRIFT');actual=new OpenAiCompatibleProvider(config);secrets=[...actual.secrets];}
      assertNoKnownSecret(safeRequest,secrets);await durable(path.join(s.root,`request-${sequence}.json`),safeRequest);
      const originalFetch=globalThis.fetch;
      globalThis.fetch=async(url,init)=>{
        must(sent<sequences.length,'HTTP_REQUEST_LIMIT');const body=JSON.parse(String(init.body));assertNoKnownSecret(body,secrets);await durable(path.join(s.root,`wire-request-${sequence}.json`),{url:String(url),method:init.method,body});
        sent++;const result=await originalFetch(url,init);const wire={status:result.status,body:await result.clone().text()};await durable(path.join(s.root,`wire-response-${sequence}.private.json`),wire);assertNoKnownSecret(wire,secrets);await durable(path.join(s.root,`wire-response-${sequence}.json`),wire);return result;
      };
      try{response=await actual.complete(request);}finally{globalThis.fetch=originalFetch;}
    } else {
      await durable(path.join(s.root,`request-${sequence}.json`),safeRequest);sent++;if(fakeFailure)throw Object.assign(new Error('SMOKE_FIRST_FAILURE'),{code:'SMOKE_FIRST_FAILURE'});response=fakeReply(request,sequence-259);
    }
    await durable(path.join(s.root,`response-${sequence}.private.json`),response);assertNoKnownSecret(response,secrets);await durable(path.join(s.root,`response-${sequence}.json`),response);return response;
  }};
  try {
    let candidate;
    if(stage==='extract') {
      const raw=entries[0],bundle=await loadExtractionRules('rules');
      checkpoint=await checkpoints.save({version:1,jobId:randomUUID(),rawId:raw.id,rawSha256:raw.bodySha256,pipelineVersion:'kb02-2',rulesVersion:bundle.rulesVersion,providerIdentity:'r22-real-'+s.mode,chunks:[{index:0,start:0,end:raw.body.length}],completedChunks:[],attempts:0,stage:'extracting',updatedAt:new Date().toISOString()});
      const {outcome}=await runKnowledgePipeline({raw,body:raw.body,bodySha256:raw.bodySha256,provider,rulesDir:'rules',checkpoint,beforeCall:async callStage=>checkpoint=await checkpoints.save({...checkpoint,stage:callStage,attempts:checkpoint.attempts+1}),saveCheckpoint:async value=>checkpoint=await checkpoints.save(value)});
      const draft=await drafts.create({raw,body:raw.body,jobId:checkpoint.jobId,outcome,rules:{types:bundle.fmcg.types.map(item=>item.id),categories:bundle.fmcg.categories.map(item=>item.id),...bundle.fmcg.enums}});
      await states.set(raw.id,{status:'pending_confirmation',reason:'R22 original capture awaiting independent review',draftId:draft.id});
      candidate={raw,draft,preview:drafts.view(draft),outcome,checkpoint};
    } else {
      const workflows=new KnowledgeWorkflowStore(s.root,wiki,raws);await workflows.initialize();const workflow=await workflows.createSynthesis({rawIds:entries.map(raw=>raw.id),provider});candidate={raws:entries,workflow,view:workflows.view(workflow)};
    }
    for(let i=0;i<entries.length;i++)must((await raws.get(entries[i].id)).bodySha256===s.rawBindings[i].bodySha256,'RAW_CHANGED');
    assertNoKnownSecret(candidate,secrets);await durable(path.join(s.root,stage+'-candidate.json'),candidate);
    const result={status:'captured-awaiting-independent-review',root:s.root,stage,reserved,sent,configReads,realCalls:s.mode==='real'?sent:0,fakeCalls:s.mode==='fake'?sent:0,knowledgeUsed:258+(s.mode==='real'?(stage==='extract'?sent:2+sent):0),promptUsed:15,candidateSha256:sha(await fs.readFile(path.join(s.root,stage+'-candidate.json')))};await durable(path.join(s.root,stage+'-result.json'),result);return result;
  } catch(error) {
    await durable(path.join(s.root,stage+'-result.json'),{status:'failed-no-retry',code:error.code??'LOCAL_RUN_FAILED',stage,reserved,sent,configReads,realCalls:s.mode==='real'?sent:0,knowledgeUsed:258+(s.mode==='real'?(stage==='extract'?sent:2+sent):0),promptUsed:15});throw error;
  }
}
export async function smoke() {
  const assert=(await import('node:assert/strict')).default,prepared=await prepare('fake'),root=prepared.session.root;
  await assert.rejects(run(root,'extract'),{code:'RELEASE_REQUIRED'});assert.equal(await exists(path.join(root,'extract-started.json')),false);
  const releaseFile=path.join(root,'fake-extract-release.json');await durable(releaseFile,{...prepared.extractReleaseTemplate,released:true,budgetApproved:true,issuedAt:new Date().toISOString()});
  const extracted=await run(root,'extract',releaseFile,sha(await fs.readFile(releaseFile)));assert.equal(extracted.fakeCalls,2);assert.equal(extracted.configReads,0);
  const synthesisFile=path.join(root,'fake-synthesis-release.json'),template={...prepared.synthesisReleaseTemplate,released:true,budgetApproved:true,issuedAt:new Date().toISOString(),extractCandidateSha256:extracted.candidateSha256};
  await durable(synthesisFile,template);await assert.rejects(run(root,'synthesis',synthesisFile,sha(await fs.readFile(synthesisFile))),{code:'EXTRACT_REVIEW_REQUIRED'});assert.equal(await exists(path.join(root,'attempt-261.json')),false);
  const approved=path.join(root,'fake-synthesis-approved.json');await durable(approved,{...template,independentExtractPass:true});const synthesized=await run(root,'synthesis',approved,sha(await fs.readFile(approved)));assert.equal(synthesized.fakeCalls,1);assert.equal(synthesized.configReads,0);
  const candidate=await read(path.join(root,'synthesis-candidate.json'));assert.deepEqual(candidate.workflow.sections.sourceList.map(source=>source.source_level),['A','D']);assert.equal(candidate.workflow.source_level,'D');
  const failed=await prepare('fake'),file=path.join(failed.session.root,'fake-release.json');await durable(file,{...failed.extractReleaseTemplate,released:true,budgetApproved:true,issuedAt:new Date().toISOString()});await assert.rejects(run(failed.session.root,'extract',file,sha(await fs.readFile(file)),true),{code:'SMOKE_FIRST_FAILURE'});assert.equal(await exists(path.join(failed.session.root,'attempt-260.json')),false);assert.equal(await exists(path.join(failed.session.root,'extract-candidate.json')),false);
  return {pass:true,fakeCalls:4,realCalls:0,configReads:0,checks:['unreleased-zero-call','extract-two-requests','independent-extract-gates-synthesis','raw-id-A-D-mapping','first-failure-stops'],root,failedRoot:failed.session.root};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,...args]=process.argv.slice(2);
  try{const result=command==='prepare'?await prepare(...args):command==='run'?await run(...args):command==='smoke'?await smoke():(()=>{throw Error('COMMAND_INVALID');})();console.log(JSON.stringify(result,null,2));}
  catch(error){console.error(JSON.stringify({code:error.code??'LOCAL_TOOL_FAILED',noAutomaticRetry:true}));process.exitCode=1;}
}
