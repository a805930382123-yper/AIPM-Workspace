// Builder invokes fake only. Independent acceptance owns prepare, release and actual run.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { RawStore } from '../../services/raw/store.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import { FROZEN_BUDGETS } from '../../services/llm/rules.ts';
import { sha, COUNTER, BUDGET_POLICY, HISTORY_USAGE, REAL_LEDGER_ROOT, assertOfflineTarget, durable, json, exists, temporary, stores, caseState, executeCase, ledgerEntries, readLedger, checkBudget, checkLedgerBinding, fakeCase } from '../support/kb03-quality-runner.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const TOOL='KB03-R5-20261030-v3';
export const FIXED_SHA='fe78a0c389fb6937950596086ee3ca3974b3a156acf9da345013a87f3593bc41';
export const FIXED_RAW_ID='daf6fde4-98e0-478d-8abe-f3abce1031ad';
const task='docs/handoffs/KB03-R8-20261030-task.md';
export async function freeze(){
  const entries=[];
  async function walk(dir){for(const item of(await fs.readdir(path.join(repo,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const relative=path.posix.join(dir,item.name);if(item.isDirectory())await walk(relative);else if(item.isFile())entries.push([relative,sha(await fs.readFile(path.join(repo,relative)))]);}}
  for(const dir of ['services','server','app','rules','tests/support'])await walk(dir);
  for(const file of [task,'package.json','package-lock.json','tests/acceptance/KB03-R5-20261030-real.mjs'])entries.push([file,sha(await fs.readFile(path.join(repo,file)))]);
  return {tool:TOOL,files:entries,digest:sha(JSON.stringify(entries))};
}
async function treeHashes(root){
  const files={};
  async function walk(relative){for(const item of(await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.posix.join(relative,item.name);if(item.isDirectory())await walk(file);else if(item.isFile())files[file]=sha(await fs.readFile(path.join(root,file)));}}
  await walk('');return files;
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
  if(await exists(REAL_LEDGER_ROOT))throw Error('Local ledger already exists; no reseed, replacement session or root reset');
  root=root?temporary(root):await fs.mkdtemp(path.join(os.tmpdir(),'kb03-r8-real-'));
  await assertOfflineTarget(root);
  if(await exists(path.join(root,'manifest.json')))throw Error('Existing preparation is immutable; no reseed');
  const version=await freeze(),session=randomUUID(),samples={};
  // No list(), reference, asset or oracle reads.
  const fixed=await new RawStore(path.join(repo,'workspace')).get(FIXED_RAW_ID);
  if(!fixed)throw Error('The one authorized fixed Raw is missing');
  for(const name of ['fixed','counter']){
    const input=name==='fixed'?fixed:{title:'虚构边界反例',sourceType:'article',sourceName:'仅虚构反例',tags:[],body:COUNTER};
    const bytes=Buffer.from(JSON.stringify(input,null,2)+'\n'),expected=name==='fixed'?FIXED_SHA:sha(COUNTER);
    if(sha(input.body)!==expected||input.body.length!==(name==='fixed'?2434:175)||Buffer.byteLength(input.body)!==(name==='fixed'?6992:467))throw Error('Frozen authorized input SHA/size mismatch');
    const chunks=chunkText(input.body,{maxChunkChars:FROZEN_BUDGETS.maxChunkChars,overlap:FROZEN_BUDGETS.chunkOverlap,maxRawChars:FROZEN_BUDGETS.maxRawChars});
    if(chunks.length!==1)throw Error('Each exact input must remain single chunk/minimum five calls');
    const dataRoot=path.join(root,'real',name),state=await stores(dataRoot),raw=await state.rawStore.create(rawInput(input));
    await fs.mkdir(path.join(root,'inputs'),{recursive:true});const copy=await fs.open(path.join(root,'inputs',name+'.json'),'wx',0o600);try{await copy.writeFile(bytes);await copy.sync();}finally{await copy.close();}
    samples[name]={sha:expected,inputFileSha:sha(bytes),chars:input.body.length,utf8Bytes:Buffer.byteLength(input.body),chunks:1,minimumCalls:BUDGET_POLICY.minimumCalls,rawId:raw.id,dataRoot};
  }
  const history={...HISTORY_USAGE,tool:TOOL,session,root,freeze:version.digest,ledgerRoot:REAL_LEDGER_ROOT};
  await fs.mkdir(path.dirname(REAL_LEDGER_ROOT),{recursive:true});await fs.mkdir(REAL_LEDGER_ROOT);
  await durable(path.join(REAL_LEDGER_ROOT,'history-summary.json'),history);
  const manifest={tool:TOOL,session,root,ledgerRoot:REAL_LEDGER_ROOT,freeze:version.digest,policy:BUDGET_POLICY,historySha:sha(await fs.readFile(path.join(REAL_LEDGER_ROOT,'history-summary.json'))),historyUsage:HISTORY_USAGE,samples,configReads:0,realRequests:0};
  await durable(path.join(root,'freeze.json'),version);await durable(path.join(root,'manifest.json'),manifest);
  await durable(path.join(root,'release-template.json'),{approved:false,tool:TOOL,session,root,freeze:version.digest,manifestSha:sha(await fs.readFile(path.join(root,'manifest.json'))),historySha:manifest.historySha,historyUsage:HISTORY_USAGE,ledgerRoot:REAL_LEDGER_ROOT,policy:BUDGET_POLICY,sampleShas:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,v.sha])),configFile:path.join(repo,'.env.local'),expectedModel:'',expectedEndpointSha:'',authorization:''});
  return manifest;
}
export async function validateRelease(root,releaseFile,releaseSha){
  root=temporary(root);const manifest=await json(path.join(root,'manifest.json')),bytes=await fs.readFile(releaseFile);
  if(!releaseSha||sha(bytes)!==releaseSha)throw Error('Release SHA required/mismatch');
  const release=JSON.parse(bytes),current=await freeze();
  if(release.approved!==true||release.tool!==TOOL||manifest.tool!==TOOL||manifest.root!==root||release.root!==root||release.manifestSha!==sha(await fs.readFile(path.join(root,'manifest.json')))||release.session!==manifest.session||release.freeze!==current.digest||manifest.freeze!==current.digest||release.ledgerRoot!==REAL_LEDGER_ROOT||manifest.ledgerRoot!==REAL_LEDGER_ROOT||typeof release.authorization!=='string'||release.authorization.trim().length<10||typeof release.expectedModel!=='string'||!release.expectedModel||!/^[a-f0-9]{64}$/.test(release.expectedEndpointSha)||typeof release.configFile!=='string'||!path.isAbsolute(release.configFile))throw Error('Release/version/identity/authorization binding is incomplete');
  if(JSON.stringify(await json(path.join(root,'freeze.json')))!==JSON.stringify(current))throw Error('Frozen file inventory/version binding mismatch');
  if(JSON.stringify(release.policy)!==JSON.stringify(BUDGET_POLICY)||JSON.stringify(manifest.policy)!==JSON.stringify(BUDGET_POLICY))throw Error('Policy must remain total20/fixed12/counter7/minimum5');
  for(const name of ['fixed','counter'])if(manifest.samples[name].dataRoot!==path.join(root,'real',name))throw Error('Input data root must be the exact isolated case root');
  for(const name of ['fixed','counter']){const expected=name==='fixed'?FIXED_SHA:sha(COUNTER);if(manifest.samples[name].sha!==expected||release.sampleShas?.[name]!==expected)throw Error('Input sample SHA binding mismatch');}
  if(JSON.stringify(manifest.historyUsage)!==JSON.stringify(HISTORY_USAGE)||JSON.stringify(release.historyUsage)!==JSON.stringify(HISTORY_USAGE))throw Error('Historical consumption authorization must retain 4/fixed4/counter0 and the original receipt gap');
  const historyBytes=await fs.readFile(path.join(REAL_LEDGER_ROOT,'history-summary.json'));
  if(sha(historyBytes)!==manifest.historySha||release.historySha!==manifest.historySha)throw Error('Historical consumption summary SHA mismatch');
  const {history}=await readLedger(REAL_LEDGER_ROOT);
  if(history.tool!==TOOL||history.session!==manifest.session||history.root!==root||history.freeze!==manifest.freeze||history.ledgerRoot!==REAL_LEDGER_ROOT)throw Error('Historical summary/session/root binding mismatch');
  for(const name of ['fixed','counter']){
    const sample=manifest.samples[name];if(sample.dataRoot!==path.join(root,'real',name))throw Error('Input data root must be the exact isolated case root');
    const raw=await new RawStore(sample.dataRoot).get(sample.rawId),inputBytes=await fs.readFile(path.join(root,'inputs',name+'.json')),input=JSON.parse(inputBytes),expected=name==='fixed'?FIXED_SHA:sha(COUNTER);
    if(release.sampleShas?.[name]!==expected||sample.sha!==expected||sha(inputBytes)!==sample.inputFileSha||sha(input.body)!==expected||!raw||sha(raw.body)!==expected||JSON.stringify(rawInput(raw))!==JSON.stringify(rawInput(input)))throw Error('Input/data root SHA or metadata mismatch');
  }
  return {manifest,release};
}
export async function readyToRun(root,name,releaseFile,releaseSha,continueExplicit){
  if(!['fixed','counter'].includes(name))throw Error('Sample must be fixed or counter');
  const checked=await validateRelease(root,releaseFile,releaseSha),{manifest}=checked,sample=manifest.samples[name],other=manifest.samples[name==='fixed'?'counter':'fixed'];
  const current=await caseState(sample.dataRoot),otherState=await caseState(other.dataRoot),{rows,counts,history}=await readLedger(REAL_LEDGER_ROOT);
  if(name==='counter'&&otherState.job?.status!=='completed')throw Error('Fresh fixed must complete successfully before counter');
  if(current.job&&current.job.status!=='completed'&&!continueExplicit)throw Error('Explicit --continue required; unknown/pending requests remain charged');
  checkBudget(counts,name,current.remaining,otherState.remaining);checkLedgerBinding(rows,{sample:name,tool:TOOL,session:manifest.session,freeze:manifest.freeze,root:sample.dataRoot,rawId:sample.rawId,jobId:current.job?.id},history);
  return {...checked,sample,otherRemaining:otherState.remaining};
}
export async function run(root,name,releaseFile,releaseSha,continueExplicit){
  const {manifest,release,sample,otherRemaining}=await readyToRun(root,name,releaseFile,releaseSha,continueExplicit);
  const {loadLlmConfig}=await import('../../services/llm/config.ts');const {OpenAiCompatibleProvider}=await import('../../services/llm/provider.ts');
  const config=await loadLlmConfig({filePath:release.configFile});
  if(config.model!==release.expectedModel||sha(config.baseUrl)!==release.expectedEndpointSha)throw Error('Configured product Provider identity does not match independent release');
  const result=await executeCase({root:sample.dataRoot,rawId:sample.rawId,provider:new OpenAiCompatibleProvider(config),ledger:REAL_LEDGER_ROOT,binding:{sample:name,sampleSha:sample.sha,freeze:manifest.freeze,session:manifest.session,tool:TOOL},otherRemaining,continueExplicit});
  await durable(path.join(root,`run-${name}-${Date.now()}-${randomUUID()}.json`),{configReads:1,model:config.model,endpointSha:sha(config.baseUrl),...result});return {configReads:1,model:config.model,endpointSha:sha(config.baseUrl),...result};
}
export async function fake(root){
  root=root?temporary(root):await fs.mkdtemp(path.join(os.tmpdir(),'kb03-r8-fake-'));
  await assertOfflineTarget(root);
  const prepared=await exists(path.join(root,'manifest.json')),ledger=path.join(root,'fake','ledger');
  if(!await exists(path.join(ledger,'history-summary.json'))){
    if((await ledgerEntries(ledger)).length)throw Error('Existing fake receipts cannot be reseeded');
    await durable(path.join(ledger,'history-summary.json'),{...HISTORY_USAGE,tool:TOOL,session:'fake-v3',freeze:'fake-v3',root:path.join(root,'fake'),ledgerRoot:ledger});
  }
  const rows=[];
  for(const name of ['fixed','counter']){
    const body=prepared?(await json(path.join(root,'inputs',name+'.json'))).body:name==='fixed'?'虚构工程样例：门店目标100家，在售20家。负责人未知。':COUNTER;
    const otherRemaining=(await caseState(path.join(root,'fake','real',name==='fixed'?'counter':'fixed'))).remaining;
    const result=await fakeCase(path.join(root,'fake','real',name),body,{ledger,sample:name,otherRemaining,session:'fake-v3',freeze:'fake-v3',tool:TOOL});
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
