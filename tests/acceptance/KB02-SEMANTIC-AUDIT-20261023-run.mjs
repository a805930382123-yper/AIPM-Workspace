// Isolated independent engineering; all source hashes captured only after explicit freeze.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const p='docs/reports/KB02-SEMANTIC-AUDIT-20261023-',sha=x=>createHash('sha256').update(x).digest('hex');
const permit=JSON.parse(await fs.readFile(p+'authorization.json','utf8'));assert.equal(permit.engineeringApproved,true,'Not frozen/released');
const extra=JSON.parse(await fs.readFile(p+'engineering-extra.json','utf8'));assert(extra.reviewed===true,'Independent/historical cases must be bound to actual frozen interface before execution');
const frozen=JSON.parse(await fs.readFile('docs/reports/KB02-SEMANTIC-20261023-frozen.json','utf8'));assert(Array.isArray(frozen.files));
for(const f of frozen.files)assert.equal(sha(await fs.readFile(f.path)),f.sha256,'Builder freeze drift '+f.path);
async function files(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.posix.join(dir,e.name);if(e.isDirectory())out.push(...await files(f));else if(e.isFile())out.push(f);}return out;}
const dirs=['app','server','services','rules','scripts','tests'];
const roots=(await fs.readdir('.',{withFileTypes:true})).filter(e=>e.isFile()&&!e.name.startsWith('.env')).map(e=>e.name);
const paths=[...roots,...(await Promise.all(dirs.map(files))).flat()];
paths.push('docs/reports/KB02-SUPPLEMENT-DIAG-20261023-source-evidence.json','docs/reports/KB02-REGION-AUDIT-20261023-provider-trace.jsonl','docs/reports/KB02-SEMANTIC-AUDIT-20261023-fixtures.json');
const expected=Object.fromEntries(await Promise.all(paths.map(async f=>[f,sha(await fs.readFile(f))])));
for(const required of ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html'])assert(Object.hasOwn(expected,required),'Missing root build file '+required);
const root=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-semantic-audit-'));
for(const d of [...dirs,'docs'])await fs.cp(d,path.join(root,d),{recursive:true});for(const f of roots)await fs.copyFile(f,path.join(root,f));await fs.symlink(path.resolve('node_modules'),path.join(root,'node_modules'),'junction');
const changed=async base=>{const out=[];for(const[f,h]of Object.entries(expected)){try{if(sha(await fs.readFile(path.join(base,f)))!==h)out.push(f);}catch{out.push(f);}}return out;};assert.deepEqual(await changed(root),[]);
const stamp=new Date().toISOString().replaceAll(':','-'),report={at:new Date().toISOString(),root,node:process.version,freezeSha256:sha(await fs.readFile('docs/reports/KB02-SEMANTIC-20261023-frozen.json')),expected,rows:[],realCalls:0};
const save=()=>fs.writeFile(p+stamp+'-engineering.json',JSON.stringify(report,null,2)+'\n');await save();
async function run(name,node,args){const started=Date.now(),child=spawn(node,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const result=await new Promise(resolve=>{child.once('error',e=>resolve({error:e.message}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});await fs.writeFile(p+stamp+'-'+name+'.log',log);const counts=Object.fromEntries(log.split(/\r?\n/).map(s=>s.match(/^ℹ (tests|pass|fail|skipped|cancelled) (\d+)/u)).filter(Boolean).map(m=>[m[1],Number(m[2])]));report.rows.push({name,command:[node,...args],...result,elapsedMs:Date.now()-started,counts,pass:result.exitCode===0&&(!args.includes('--test')||(counts.tests>0&&counts.tests===counts.pass&&counts.skipped===0&&counts.cancelled===0&&counts.fail===0))});await save();console.log(JSON.stringify(report.rows.at(-1)));}
const baseArgs=['--import','tsx','--import','./tests/support/css-stub.mjs','--test'],defaults=(await fs.readdir('tests')).filter(f=>/\.test\.tsx?$/u.test(f)).map(f=>'tests/'+f);
await run('default',process.execPath,[...baseArgs,...defaults]);await run('tsc',process.execPath,['node_modules/typescript/bin/tsc','-b']);await run('vite',process.execPath,['node_modules/vite/bin/vite.js','build']);
const node24=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');await run('node24-version',node24,['--version']);
const relevant=defaults.filter(f=>/kb02|pa01-r01-r02|pa01-sol-recovery|b05|wiki-selection/.test(f));await run('node24-related-sr01',node24,[...baseArgs,...relevant]);
// Additional independent/historical acceptance commands are frozen in a reviewed manifest.
for(const row of extra.commands)await run(row.name,process.execPath,row.args);
report.sourceChanges=await changed('.');report.copyChanges=await changed(root);report.pass=report.rows.every(r=>r.pass)&&!report.sourceChanges.length&&!report.copyChanges.length;await save();await fs.writeFile(p+'engineering-latest.json',JSON.stringify(report,null,2)+'\n');if(!report.pass)process.exitCode=1;
