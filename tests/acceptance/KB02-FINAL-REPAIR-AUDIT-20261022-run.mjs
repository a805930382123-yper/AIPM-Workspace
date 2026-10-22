import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const prefix='docs/reports/KB02-FINAL-REPAIR-AUDIT-20261022-',sha=b=>createHash('sha256').update(b).digest('hex');
const mode=process.argv[2]??'targeted';
const frozen=JSON.parse(await fs.readFile('docs/reports/KB02-FINAL-REPAIR-20261022-builder-frozen.json','utf8'));
const expected={...frozen.product,...frozen.tests,...frozen.fixtures,...frozen.acceptanceScripts};
async function changes(root){const out=[];for(const[p,h]of Object.entries(expected)){try{if(sha(await fs.readFile(path.join(root,p)))!==h)out.push(p);}catch{out.push(p);}}return out;}
if((await changes('.')).length)throw Error('Source differs from freeze');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-final-repair-'));
for(const dir of ['app','server','services','rules','scripts','tests'])await fs.cp(dir,path.join(root,dir),{recursive:true});
for(const file of Object.keys(frozen.product).filter(f=>!f.includes('/')))await fs.copyFile(file,path.join(root,file));
await fs.mkdir(path.join(root,'docs/reports'),{recursive:true});
await fs.symlink(path.resolve('node_modules'),path.join(root,'node_modules'),'junction');
const report={at:new Date().toISOString(),mode,root,runtime:process.version,copyMismatch:await changes(root),rows:[],realCalls:0};
if(report.copyMismatch.length)throw Error('Copy differs from freeze');
const stamp=new Date().toISOString().replaceAll(':','-');
async function run(name,node,args){
 const start=Date.now(),child=spawn(node,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const result=await new Promise(resolve=>{child.once('error',e=>resolve({error:e.message}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});
 await fs.writeFile(prefix+stamp+'-'+name+'.log',log);const row={name,command:[node,...args],...result,durationMs:Date.now()-start,summary:log.split(/\r?\n/u).filter(s=>/^ℹ (tests|pass|fail|skipped|cancelled|duration)/u.test(s))};report.rows.push(row);await fs.writeFile(prefix+stamp+'-run.json',JSON.stringify(report,null,2));console.log(JSON.stringify(row));
}
console.log(JSON.stringify({root,stamp,mode}));
const args=['--import','tsx','--import','./tests/support/css-stub.mjs','--test'];
const targeted=['tests/kb02-final-classification.test.ts','tests/kb02-final-agreement.test.ts','tests/kb02-classification-priority.test.ts','tests/kb02-extraction-contract.test.ts','tests/kb02-r2.test.ts','tests/b05.test.ts'];
const sr01=['tests/kb02-job-file-access.test.ts','tests/pa01-r01-r02.test.ts','tests/pa01-sol-recovery.test.ts','tests/kb02-sr01-r1.test.ts','tests/kb02-planning-budget.test.ts','tests/kb02-storage-recovery.test.ts','tests/kb02-storage-http.test.ts','tests/kb02-storage-ui.test.tsx'];
if(mode==='targeted')await run('targeted',process.execPath,[...args,...targeted]);
else if(mode==='full'){
 const defaults=(await fs.readdir(path.join(root,'tests'))).filter(f=>/\.test\.tsx?$/u.test(f)).map(f=>'tests/'+f);
 await run('fullsuite',process.execPath,[...args,...defaults]);
 await run('tsc',process.execPath,['node_modules/typescript/bin/tsc','-b']);
 await run('vite',process.execPath,['node_modules/vite/bin/vite.js','build']);
 const oldNode=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
 await run('node24-version',oldNode,['--version']);
 await run('node24-sr01',oldNode,[...args,...sr01]);
 await run('node24-repair',oldNode,[...args,...targeted]);
}else throw Error('mode');
report.afterCopyChanges=await changes(root);report.pass=report.rows.every(r=>r.exitCode===0)&&!report.afterCopyChanges.length;
await fs.writeFile(prefix+stamp+'-run.json',JSON.stringify(report,null,2));await fs.writeFile(prefix+mode+'-latest-run.json',JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;

