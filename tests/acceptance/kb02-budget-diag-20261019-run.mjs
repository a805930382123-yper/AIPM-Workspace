import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const prefix='docs/reports/KB02-BUDGET-DIAG-20261019-';
const batch=process.argv[2]??'baseline';
const outputDir=path.resolve(prefix+batch+'-events');
await fs.mkdir(outputDir,{recursive:true});
const test='tests/kb02-planning-budget.test.ts', hook='./tests/acceptance/kb02-budget-diag-20261019-hook.mjs';
const frozen=JSON.parse(await fs.readFile('docs/reports/KB02-R2-Q02-20261018-builder-main-frozen.json','utf8'));
const owned={...frozen.product,...frozen.tests};
const hashes=async()=>{const result={};for(const file of Object.keys(owned)) result[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');return result;};
const before=await hashes();
const nodes=[['system25',process.execPath],['bundle24','C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe']];
const rows=[];
let fullResult;
async function run(nodeLabel,nodePath,tag,mode='observe',pattern){
  const args=['--import','tsx','--import',hook,'--test',...(pattern?['--test-name-pattern='+pattern]:[]),test];
  const start=Date.now(),child=spawn(nodePath,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,KB02_DIAG_MODE:mode,KB02_DIAG_OUTPUT:outputDir,KB02_DIAG_TAG:tag}});
  let output=''; child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const result=await new Promise(resolve=>{child.on('error',e=>resolve({spawnError:e.message}));child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});
  await fs.writeFile(prefix+tag+'.log',output);
  const row={nodeLabel,nodePath,tag,mode,args,...result,durationMs:Date.now()-start,summary:output.split(/\r?\n/u).filter(l=>/^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|duration)/u.test(l))};
  rows.push(row);console.log(JSON.stringify(row));
}
if(batch==='baseline') {
  for(const [label,binary]of nodes)for(let n=1;n<=3;n++)await run(label,binary,`${batch}-${label}-${n}`);
}else if(batch==='load') {
  for(const [label,binary]of nodes)await Promise.all(Array.from({length:8},(_,i)=>run(label,binary,`${batch}-${label}-${i+1}`)));
}else if(batch==='faults') {
  for(const mode of ['failed-job-rename','done-checkpoint-rename','coverage-checkpoint-rename'])
    await run(nodes[0][0],nodes[0][1],`${batch}-${mode}`,mode,mode==='done-checkpoint-rename'?'last available':'exhausted explicit');
}else if(batch==='full24') {
  // One comparable whole-suite observation is justified by the historical failures
  // appearing only under the complete default suite, never in targeted checks.
  const os=await import('node:os');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-budget-diag-full-'));
  for(const dir of ['app','server','services','rules','scripts','tests'])await fs.cp(path.resolve(dir),path.join(root,dir),{recursive:true});
  const rootFiles=new Set(['package.json','package-lock.json','.env.example','.gitignore','vite.config.ts','tsconfig.json','index.html',...Object.keys(owned).filter(f=>!f.includes('/'))]);
  for(const file of rootFiles)await fs.copyFile(file,path.join(root,file));
  await fs.mkdir(path.join(root,'docs','reports'),{recursive:true});
  await fs.symlink(path.resolve('node_modules'),path.join(root,'node_modules'),'junction');
  const copyMismatches=[];
  for(const [file,expected]of Object.entries(owned))if(createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')!==expected)copyMismatches.push(file);
  if(copyMismatches.length)throw Error('Diagnostic copy mismatch');
  const files=(await fs.readdir(path.join(root,'tests'))).filter(f=>/\.test\.tsx?$/u.test(f)).map(f=>'tests/'+f);
  const args=['--import','tsx','--import','./tests/support/css-stub.mjs','--import',hook,'--test',...files];
  const start=Date.now(),child=spawn(nodes[1][1],args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,KB02_DIAG_MODE:'observe',KB02_DIAG_OUTPUT:outputDir,KB02_DIAG_TAG:batch}});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const result=await new Promise(resolve=>{child.on('error',e=>resolve({spawnError:e.message}));child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});
  await fs.writeFile(prefix+batch+'.log',output);
  const row={nodeLabel:'bundle24',nodePath:nodes[1][1],tag:batch,mode:'observe',...result,durationMs:Date.now()-start,summary:output.split(/\r?\n/u).filter(l=>/^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|duration)/u.test(l))};
  rows.push(row);fullResult={root,copyMismatches,testFiles:files.length};console.log(JSON.stringify(row));
}else throw Error('Unknown diagnostic batch');
const after=await hashes(),sourceChanges=Object.keys(before).filter(file=>before[file]!==after[file]);
const eventFiles=(await fs.readdir(outputDir)).filter(f=>f.endsWith('.json'));
const eventSummary=[];
for(const f of eventFiles){const e=JSON.parse(await fs.readFile(path.join(outputDir,f),'utf8'));eventSummary.push({file:f,node:e.node,mode:e.mode,events:e.events.length,failures:e.events.filter(x=>x.ok===false||x.kind==='unhandledRejection'),lastJobs:e.events.filter(x=>x.kind==='ExtractionJobStore'&&x.value).slice(-4)});}
await fs.writeFile(prefix+batch+'.json',JSON.stringify({at:new Date().toISOString(),scope:'original tests, explicit diagnostic preload; localhost fake only, no source product/test changes',batch,...(fullResult??{}),rows,eventSummary,sourceChanges,externalCalls:0},null,2));
console.log(JSON.stringify({batch,pass:rows.filter(r=>r.exitCode===0).length,runs:rows.length,sourceChanges}));
