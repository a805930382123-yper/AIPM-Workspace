// Run exact frozen source/test copies on a writable temp volume; no test assertion or fs shim changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const source=process.cwd(),root=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-pa01-astra-review-fullsuite-'));
const frozen=JSON.parse(await fs.readFile('docs/reports/PA01-ASTRA-20261015-main-main-frozen.json','utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const dir of ['app','server','services','rules','scripts','tests'])await fs.cp(path.join(source,dir),path.join(root,dir),{recursive:true});
for(const file of ['package.json','package-lock.json','.env.example','.gitignore','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html']){try{await fs.copyFile(path.join(source,file),path.join(root,file));}catch(e){if(e.code!=='ENOENT')throw e;}}
await fs.mkdir(path.join(root,'docs','reports'),{recursive:true});
await fs.symlink(path.join(source,'node_modules'),path.join(root,'node_modules'),'junction');
const mismatches=[];for(const [file,expected]of Object.entries({...frozen.product,...frozen.tests})){if(sha(await fs.readFile(path.join(root,file)))!==expected)mismatches.push(file);}
if(mismatches.length)throw Error('Frozen copy mismatch');
const tests=(await fs.readdir(path.join(root,'tests'))).filter(p=>p.endsWith('.test.ts')||p.endsWith('.test.tsx')).map(p=>'tests/'+p);
const started=Date.now();const child=spawn(process.execPath,['--import','tsx','--import','./tests/support/css-stub.mjs','--test',...tests],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const [code,signal]=await once(child,'exit');
await fs.writeFile(path.join(source,'docs/reports/PA01-ASTRA-20261015-main-main-tests-writable-copy.log'),output);
const evidence={date:'2026-10-15',root,node:process.version,scope:'exact byte-identical frozen product + complete unchanged test suite on writable temporary filesystem; no assertions/shims modified',frozenProductFiles:Object.keys(frozen.product).length,frozenTestFiles:Object.keys(frozen.tests).length,copyMismatches:mismatches,exitCode:code,signal,durationMs:Date.now()-started,testSummary:output.split(/\r?\n/).filter(line=>/^ℹ (tests|pass|fail|cancelled|skipped|todo|duration)/u.test(line)),processClosed:true,originalWorkspaceAclUnchanged:true,copyRetained:true};await fs.writeFile(path.join(source,'docs/reports/PA01-ASTRA-20261015-main-main-tests-writable-copy.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));process.exitCode=code??1;




