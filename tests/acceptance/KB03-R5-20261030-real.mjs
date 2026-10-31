// Builder invokes fake only. Independent acceptance owns prepare, release and actual run.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { RawStore } from '../../services/raw/store.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { FROZEN_BUDGETS } from '../../services/llm/rules.ts';
import { sanitizeProviderText } from '../../services/llm/provider.ts';
import { sha, COUNTER, BUDGET_POLICY, HISTORY_USAGE, REAL_LEDGER_ROOT, R8_ROOT, R10_TOOL, R10_SESSION_FILE, R10_STOP_FILE, treeHashes, startR10Session, stopR10Round, assertOfflineTarget, durable, json, exists, temporary, stores, caseState, executeCase, ledgerEntries, readLedger, checkBudget, checkLedgerBinding, fakeCase } from '../support/kb03-quality-runner.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const TOOL=R10_TOOL;
export const FIXED_SHA='fe78a0c389fb6937950596086ee3ca3974b3a156acf9da345013a87f3593bc41';
export const FIXED_RAW_ID='daf6fde4-98e0-478d-8abe-f3abce1031ad';
const task='docs/handoffs/KB03-R10-20261031-task.md';
export async function freeze(){
  const entries=[];
  async function walk(dir){for(const item of(await fs.readdir(path.join(repo,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const relative=path.posix.join(dir,item.name);if(item.isDirectory())await walk(relative);else if(item.isFile())entries.push([relative,sha(await fs.readFile(path.join(repo,relative)))]);}}
  for(const dir of ['services','server','app','rules','tests/support'])await walk(dir);
  for(const file of [task,'package.json','package-lock.json','tests/acceptance/KB03-R5-20261030-real.mjs'])entries.push([file,sha(await fs.readFile(path.join(repo,file)))]);
  return {tool:TOOL,files:entries,digest:sha(JSON.stringify(entries))};
}
export async function captureMigration(sourceRoot,ledgerRoot){
  sourceRoot=temporary(sourceRoot);const rows=await ledgerEntries(ledgerRoot);
  if(rows.length!==4||rows.some(r=>r.sample!=='fixed'))throw Error('Migration requires exactly four historical fixed attempts');
  const ledgerFiles=await treeHashes(ledgerRoot);
  return {sourceRoot,ledgerRoot,oldFiles:await treeHashes(sourceRoot),ledgerFiles,historicalCalls:4,historicalFixed:4};
}
export async function verifyMigration(baseline){
  if(!baseline||baseline.historicalCalls!==4||baseline.historicalFixed!==4)throw Error('Migration baseline missing');
  temporary(baseline.sourceRoot);
  if(JSON.stringify(await treeHashes(baseline.sourceRoot))!==JSON.stringify(baseline.oldFiles))throw Error('Historical source/job/manifest/trace changed');
  const files=(await fs.readdir(baseline.ledgerRoot)).filter(n=>/^attempt-0[1-4](\.|$)/.test(n)).sort();
  if(JSON.stringify(files)!==JSON.stringify(Object.keys(baseline.ledgerFiles).filter(n=>/^attempt-0[1-4](\.|$)/.test(n))))throw Error('Historical ledger receipt inventory changed');
  for(const [file,digest] of Object.entries(baseline.ledgerFiles))if(sha(await fs.readFile(path.join(baseline.ledgerRoot,file)))!==digest)throw Error('Historical ledger receipt changed');
  const rows=await ledgerEntries(baseline.ledgerRoot);if(rows.length<4||rows.slice(0,4).some(r=>r.sample!=='fixed'))throw Error('Historical four attempts lost');
}
function rawInput(input){return Object.fromEntries(['title','sourceType','sourceName','tags','author','publishedAt','url','body','assetId','assetFileName','assetFormat','assetByteSize','assetSha256','extractionParser','extractionNote'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));}
// SOURCE DEFINITION ONLY: the independent acceptance agent executes this after
// builder handoff. Builder tests invoke fake, never prepare or real run.
export async function prepare(root){
  if(await exists(path.join(REAL_LEDGER_ROOT,R10_SESSION_FILE)))throw Error('R10 session already exists; no reseed, replacement session or root reset');
  const prior=await readLedger(REAL_LEDGER_ROOT);
  if(sha(await fs.readFile(path.join(REAL_LEDGER_ROOT,'history-summary.json')))!=='202678c10da5b8aa39c9eedef5798d0570dc10d663372c942eab6cdd3b94fd8e'||JSON.stringify(prior.counts)!==JSON.stringify({total:14,fixed:9,counter:5}))throw Error('Original R8 history/cumulative14 evidence mismatch');
  root=root?temporary(root):await fs.mkdtemp(path.join(os.tmpdir(),'kb03-r10-real-'));
  await assertOfflineTarget(root);
  if(await exists(path.join(root,'manifest.json')))throw Error('Existing preparation is immutable; no reseed');
  const version=await freeze(),session=randomUUID(),samples={};
  // Read only the two frozen R8 input files; never formal workspace/reference/oracle.
  for(const name of ['fixed','counter']){
    const bytes=await fs.readFile(path.join(R8_ROOT,'inputs',name+'.json')),input=JSON.parse(bytes),expected=name==='fixed'?FIXED_SHA:sha(COUNTER);
    if(sha(input.body)!==expected||input.body.length!==(name==='fixed'?2434:175)||Buffer.byteLength(input.body)!==(name==='fixed'?6992:467))throw Error('Frozen authorized input SHA/size mismatch');
    const chunks=chunkText(input.body,{maxChunkChars:FROZEN_BUDGETS.maxChunkChars,overlap:FROZEN_BUDGETS.chunkOverlap,maxRawChars:FROZEN_BUDGETS.maxRawChars});
    if(chunks.length!==1)throw Error('Each exact input must remain single chunk/minimum five calls');
    const dataRoot=path.join(root,'real',name),state=await stores(dataRoot),raw=await state.rawStore.create(rawInput(input));
    await fs.mkdir(path.join(root,'inputs'),{recursive:true});const copy=await fs.open(path.join(root,'inputs',name+'.json'),'wx',0o600);try{await copy.writeFile(bytes);await copy.sync();}finally{await copy.close();}
    samples[name]={sha:expected,inputFileSha:sha(bytes),chars:input.body.length,utf8Bytes:Buffer.byteLength(input.body),chunks:1,minimumCalls:BUDGET_POLICY.minimumCalls,rawId:raw.id,dataRoot};
  }
  await startR10Session({root,ledger:REAL_LEDGER_ROOT,sourceRoot:R8_ROOT,freeze:version.digest,session});
  const manifest={tool:TOOL,session,root,sourceRoot:R8_ROOT,ledgerRoot:REAL_LEDGER_ROOT,freeze:version.digest,policy:BUDGET_POLICY,sessionSha:sha(await fs.readFile(path.join(REAL_LEDGER_ROOT,R10_SESSION_FILE))),historySha:sha(await fs.readFile(path.join(REAL_LEDGER_ROOT,'history-summary.json'))),historyUsage:HISTORY_USAGE,samples,configReads:0,realRequests:0};
  await durable(path.join(root,'freeze.json'),version);await durable(path.join(root,'manifest.json'),manifest);
  await durable(path.join(root,'release-template.json'),{approved:false,tool:TOOL,session,root,sourceRoot:R8_ROOT,freeze:version.digest,manifestSha:sha(await fs.readFile(path.join(root,'manifest.json'))),sessionSha:manifest.sessionSha,historySha:manifest.historySha,historyUsage:HISTORY_USAGE,ledgerRoot:REAL_LEDGER_ROOT,policy:BUDGET_POLICY,sampleShas:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,v.sha])),configFile:path.join(repo,'.env.local'),expectedModel:'',expectedEndpointSha:'',authorization:''});
  return manifest;
}
export async function validateRelease(root,releaseFile,releaseSha){
  root=temporary(root);const manifest=await json(path.join(root,'manifest.json')),bytes=await fs.readFile(releaseFile);
  if(!releaseSha||sha(bytes)!==releaseSha)throw Error('Release SHA required/mismatch');
  const release=JSON.parse(bytes),current=await freeze();
  if(release.approved!==true||release.tool!==TOOL||manifest.tool!==TOOL||manifest.root!==root||release.root!==root||release.manifestSha!==sha(await fs.readFile(path.join(root,'manifest.json')))||release.session!==manifest.session||release.freeze!==current.digest||manifest.freeze!==current.digest||release.ledgerRoot!==REAL_LEDGER_ROOT||manifest.ledgerRoot!==REAL_LEDGER_ROOT||typeof release.authorization!=='string'||release.authorization.trim().length<10||typeof release.expectedModel!=='string'||!release.expectedModel||!/^[a-f0-9]{64}$/.test(release.expectedEndpointSha)||typeof release.configFile!=='string'||!path.isAbsolute(release.configFile))throw Error('Release/version/identity/authorization binding is incomplete');
  if(JSON.stringify(await json(path.join(root,'freeze.json')))!==JSON.stringify(current))throw Error('Frozen file inventory/version binding mismatch');
  if(JSON.stringify(release.policy)!==JSON.stringify(BUDGET_POLICY)||JSON.stringify(manifest.policy)!==JSON.stringify(BUDGET_POLICY))throw Error('Policy must remain total30/fixed20/counter15/minimum5');
  for(const name of ['fixed','counter'])if(manifest.samples[name].dataRoot!==path.join(root,'real',name))throw Error('Input data root must be the exact isolated case root');
  for(const name of ['fixed','counter']){const expected=name==='fixed'?FIXED_SHA:sha(COUNTER);if(manifest.samples[name].sha!==expected||release.sampleShas?.[name]!==expected)throw Error('Input sample SHA binding mismatch');}
  if(JSON.stringify(manifest.historyUsage)!==JSON.stringify(HISTORY_USAGE)||JSON.stringify(release.historyUsage)!==JSON.stringify(HISTORY_USAGE))throw Error('Historical consumption authorization must retain 4/fixed4/counter0 and the original receipt gap');
  const historyBytes=await fs.readFile(path.join(REAL_LEDGER_ROOT,'history-summary.json'));
  if(sha(historyBytes)!==manifest.historySha||release.historySha!==manifest.historySha)throw Error('Historical consumption summary SHA mismatch');
  const sessionBytes=await fs.readFile(path.join(REAL_LEDGER_ROOT,R10_SESSION_FILE));
  if(sha(sessionBytes)!==manifest.sessionSha||release.sessionSha!==manifest.sessionSha)throw Error('R10 session file SHA mismatch');
  const {round,stopped}=await readLedger(REAL_LEDGER_ROOT);
  if(!round||round.tool!==TOOL||round.session!==manifest.session||round.root!==root||round.freeze!==manifest.freeze||round.ledgerRoot!==REAL_LEDGER_ROOT||round.sourceRoot!==R8_ROOT||manifest.sourceRoot!==R8_ROOT||release.sourceRoot!==R8_ROOT)throw Error('R10 session/root binding mismatch');
  if(stopped)throw Error('R10 round stopped after failure; no retry, continue or counter');
  for(const name of ['fixed','counter']){
    const sample=manifest.samples[name];if(sample.dataRoot!==path.join(root,'real',name))throw Error('Input data root must be the exact isolated case root');
    const raw=await new RawStore(sample.dataRoot).get(sample.rawId),inputBytes=await fs.readFile(path.join(root,'inputs',name+'.json')),input=JSON.parse(inputBytes),expected=name==='fixed'?FIXED_SHA:sha(COUNTER);
    if(release.sampleShas?.[name]!==expected||sample.sha!==expected||sha(inputBytes)!==sample.inputFileSha||sha(input.body)!==expected||!raw||sha(raw.body)!==expected||JSON.stringify(rawInput(raw))!==JSON.stringify(rawInput(input)))throw Error('Input/data root SHA or metadata mismatch');
  }
  return {manifest,release};
}
export async function readyToRun(root,name,releaseFile,releaseSha,continueExplicit){
  if(continueExplicit)throw Error('R10 forbids --continue or retry of this round');
  if(!['fixed','counter'].includes(name))throw Error('Sample must be fixed or counter');
  const checked=await validateRelease(root,releaseFile,releaseSha),{manifest}=checked,sample=manifest.samples[name],other=manifest.samples[name==='fixed'?'counter':'fixed'];
  const current=await caseState(sample.dataRoot),otherState=await caseState(other.dataRoot),ledgerState=await readLedger(REAL_LEDGER_ROOT);
  if(name==='counter'&&otherState.job?.status!=='completed')throw Error('Fresh fixed must complete successfully before counter');
  if(current.job&&current.job.status!=='completed')throw Error('R10 failed/interrupted job cannot reenter or retry');
  checkBudget(ledgerState.counts,name,current.remaining,otherState.remaining);checkLedgerBinding(ledgerState,{sample:name,tool:TOOL,session:manifest.session,freeze:manifest.freeze,root:sample.dataRoot,rawId:sample.rawId,jobId:current.job?.id});
  return {...checked,sample,otherRemaining:otherState.remaining};
}
export async function run(root,name,releaseFile,releaseSha,continueExplicit){
  if(continueExplicit)throw Error('R10 forbids --continue or retry of this round');
  let provider;
  try{
  const {manifest,release,sample,otherRemaining}=await readyToRun(root,name,releaseFile,releaseSha,continueExplicit);
  const {loadLlmConfig}=await import('../../services/llm/config.ts');const {OpenAiCompatibleProvider}=await import('../../services/llm/provider.ts');
  const config=await loadLlmConfig({filePath:release.configFile});
  if(config.model!==release.expectedModel||sha(config.baseUrl)!==release.expectedEndpointSha)throw Error('Configured product Provider identity does not match independent release');
  provider=new OpenAiCompatibleProvider(config);
  const result=await executeCase({root:sample.dataRoot,rawId:sample.rawId,provider,ledger:REAL_LEDGER_ROOT,binding:{sample:name,sampleSha:sample.sha,freeze:manifest.freeze,session:manifest.session,tool:TOOL},otherRemaining,continueExplicit});
  await durable(path.join(root,`run-${name}-${Date.now()}-${randomUUID()}.json`),{configReads:1,model:config.model,endpointSha:sha(config.baseUrl),...result});return {configReads:1,model:config.model,endpointSha:sha(config.baseUrl),...result};
  }catch(error){
    const sessionFile=path.join(REAL_LEDGER_ROOT,R10_SESSION_FILE);
    if(await exists(sessionFile)&&(await json(sessionFile)).root===path.resolve(root))await stopR10Round(REAL_LEDGER_ROOT,{code:typeof error.code==='string'?error.code:'R10_RUN_FAILED',reason:provider?sanitizeProviderText(error.message,provider.secrets):'R10 release/configuration/evidence check failed; round stopped'});
    throw error;
  }
}
export async function fake(root){
  root=root?temporary(root):await fs.mkdtemp(path.join(os.tmpdir(),'kb03-r10-fake-'));
  await assertOfflineTarget(root);
  const prepared=await exists(path.join(root,'manifest.json')),ledger=path.join(root,'fake','ledger'),oldRoot=path.join(root,'fake','r8'),newRoot=path.join(root,'fake','r10');
  if(!await exists(path.join(ledger,'history-summary.json'))){
    if((await ledgerEntries(ledger)).length)throw Error('Existing fake receipts cannot be reseeded');
    await durable(path.join(oldRoot,'manifest.json'),{tool:'KB03-R5-20261030-v3',syntheticPrior:true});
    await durable(path.join(ledger,'history-summary.json'),{...HISTORY_USAGE,tool:'KB03-R5-20261030-v3',session:'fake-v3',freeze:'fake-v3',root:oldRoot,ledgerRoot:ledger});
    for(let sequence=5;sequence<=14;sequence++){
      const sample=sequence<10?'fixed':'counter',prefix=path.join(ledger,`attempt-${String(sequence).padStart(2,'0')}`);
      await durable(prefix+'.json',{sequence,sample,state:'pending',tool:'KB03-R5-20261030-v3',session:'fake-v3',freeze:'fake-v3',root:path.join(oldRoot,'real',sample),rawId:`synthetic-old-${sample}`,jobId:`synthetic-old-${sample}`,stage:'synthetic-prior'});
      await durable(prefix+'.request.json',{syntheticPrior:true});await durable(prefix+'.result.json',{state:'received',syntheticPrior:true});
    }
  }
  if(!await exists(path.join(ledger,R10_SESSION_FILE)))await startR10Session({root:newRoot,ledger,sourceRoot:oldRoot,session:'fake-v4',freeze:'fake-v4'});
  const rows=[];
  for(const name of ['fixed','counter']){
    const body=prepared?(await json(path.join(root,'inputs',name+'.json'))).body:name==='fixed'?'虚构工程样例：门店目标100家，在售20家。负责人未知。':COUNTER;
    const otherRemaining=(await caseState(path.join(newRoot,'real',name==='fixed'?'counter':'fixed'))).remaining;
    const result=await fakeCase(path.join(newRoot,'real',name),body,{ledger,sample:name,otherRemaining,session:'fake-v4',freeze:'fake-v4',tool:TOOL});
    rows.push({sample:name,status:result.job?.status,callCount:result.ownCalls,wires:result.wires});
    if(result.job?.status!=='completed'||![0,5].includes(result.ownCalls))throw Error('Fake N+4 failed: '+JSON.stringify(rows.at(-1)));
  }
  const {counts}=await readLedger(ledger);
  await durable(path.join(root,`fake-summary-${Date.now()}.json`),{root,preparedInputs:prepared,configReads:0,realRequests:0,policy:BUDGET_POLICY,counts,rows,qualityVerdict:'NOT_SCORED: fake engineering only'});
  return {root,configReads:0,realRequests:0,counts,rows};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const[mode,root,...args]=process.argv.slice(2);
  if(mode==='prepare'&&args.length)throw Error('prepare reads only the fixed authorized Raw; no source-root override');
  const result=mode==='prepare'?await prepare(root==='-'?undefined:root):mode==='fake'?await fake(root):mode==='run'?await run(root,args[0],args[1],args[2],args[3]==='--continue'):(()=>{throw Error('Use prepare <new-TEMP-root|-> | fake [TEMP-root] | run TEMP-root fixed|counter release.json releaseSHA [--continue]');})();
  console.log(JSON.stringify(result,null,2));if(mode==='run'&&result.job?.status!=='completed')process.exitCode=1;
}
