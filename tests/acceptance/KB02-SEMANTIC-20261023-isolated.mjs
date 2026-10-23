import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
const source=process.cwd(),root=path.join(source,'.scratch-KB02-SEMANTIC-20261023'),prefix=path.join(source,'docs/reports/KB02-SEMANTIC-20261023-');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function list(dir,base=source){const out=[];for(const e of await fs.readdir(path.join(base,dir),{withFileTypes:true})){const r=path.join(dir,e.name);if(e.isDirectory())out.push(...await list(r,base));else out.push(r.replaceAll('\\','/'));}return out;}
const productDirs=['app','server','services','rules','scripts','tests'];
const rootFiles=(await fs.readdir(source,{withFileTypes:true})).filter(e=>e.isFile()&&(/^(package(-lock)?\.json|tsconfig.*\.json|vite\.config\..*|index\.html|eslint.*|\.gitignore)$/u.test(e.name))).map(e=>e.name);
const selected=[...rootFiles,...(await Promise.all(productDirs.map(d=>list(d)))).flat()].filter(p=>!p.includes('KB02-SEMANTIC-AUDIT-20261023-'));
async function snapshot(base){return Promise.all(selected.map(async p=>({path:p,sha256:sha(await fs.readFile(path.join(base,p)))})));}
const mode=process.argv[2],tag=process.argv[3]??mode;
if(mode==='prepare'){
 await fs.mkdir(root);for(const dir of productDirs)await fs.cp(path.join(source,dir),path.join(root,dir),{recursive:true});for(const f of rootFiles)await fs.copyFile(path.join(source,f),path.join(root,f));
 await fs.cp(path.join(source,'docs/reports'),path.join(root,'docs/reports'),{recursive:true});await fs.symlink(path.join(source,'node_modules'),path.join(root,'node_modules'),'junction');
 const sourceFiles=await snapshot(source),copied=await snapshot(root);if(JSON.stringify(sourceFiles)!==JSON.stringify(copied))throw Error('copy mismatch');await fs.writeFile(prefix+'copy-baseline.json',JSON.stringify({root,node:process.version,files:sourceFiles},null,2),{flag:'wx'});console.log(JSON.stringify({root,files:sourceFiles.length,copyMismatch:0}));
}else if(mode==='refresh'){
 // Copy only the explicitly supplied changed source/test files after local fixture repairs.
 for(const f of process.argv.slice(4)){if(!selected.includes(f))throw Error('out-of-scope copy');await fs.copyFile(path.join(source,f),path.join(root,f));}console.log('refreshed explicit files');
}else if(mode==='verify'){
 const a=await snapshot(source),b=await snapshot(root),mismatch=a.filter((f,i)=>f.sha256!==b[i].sha256);await fs.writeFile(prefix+tag+'.json',JSON.stringify({root,files:a,mismatch},null,2),{flag:'wx'});console.log(JSON.stringify({files:a.length,mismatch}));if(mismatch.length)process.exitCode=1;
}else{
 const node=mode.startsWith('node24')?path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'):process.execPath;
 const testArgs=['--import','tsx','--import','./tests/support/css-stub.mjs','--test'];
 const sr=['kb02-job-file-access.test.ts','pa01-r01-r02.test.ts','pa01-sol-recovery.test.ts','kb02-sr01-r1.test.ts','kb02-planning-budget.test.ts','kb02-storage-recovery.test.ts','kb02-storage-http.test.ts','kb02-storage-ui.test.tsx'].map(f=>'tests/'+f);
 const affected=(await fs.readdir(path.join(root,'tests'))).filter(f=>/^kb02.*\.test\.tsx?$/u.test(f)||['llm-flow.test.ts','llm-http.test.ts','llm-repair3.test.ts','llm.test.ts','provider-knowledge-reasoning.test.ts'].includes(f)).map(f=>'tests/'+f);
 const defaults=(await fs.readdir(path.join(root,'tests'))).filter(f=>/\.test\.tsx?$/u.test(f)).map(f=>'tests/'+f);
 const jobs=mode==='build'?[['tsc',[ 'node_modules/typescript/bin/tsc','-b']],['vite',['node_modules/vite/bin/vite.js','build']]]:mode==='node24-version'?[['version',['--version']]]:[[tag,[...testArgs,...(mode==='full'?defaults:mode==='node24-sr01'?sr:affected)]]];
 for(const [name,args]of jobs){const started=Date.now(),child=spawn(node,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});await fs.writeFile(prefix+name+'.log',log,{flag:'wx'});const summary={root,node,args,code,elapsedMs:Date.now()-started,summary:log.split(/\r?\n/u).filter(l=>/^ℹ (tests|pass|fail|skipped|cancelled|duration)/u.test(l))};await fs.writeFile(prefix+name+'.json',JSON.stringify(summary,null,2),{flag:'wx'});console.log(JSON.stringify(summary));if(code)process.exitCode=code;}
}
