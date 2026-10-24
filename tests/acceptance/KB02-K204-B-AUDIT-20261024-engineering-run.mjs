import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(),P='docs/reports/KB02-K204-B-AUDIT-20261024-',stamp=new Date().toISOString().replace(/[:.]/g,'-'),sha=b=>createHash('sha256').update(b).digest('hex');
const freezePath='docs/reports/KB02-K204-B-20261024-freeze.json',bytes=await fs.readFile(freezePath);assert.equal(sha(bytes),'12dad741181e7e74a95d58d2f49a24774343c6f11903b1083d7bbb4d4f6f2463');const freeze=JSON.parse(bytes);
const root=await fs.mkdtemp(path.resolve('.scratch-KB02-K204-B-AUDIT-'));const report={startedAt:new Date().toISOString(),node:process.version,root,freezeSha256:sha(bytes),frozenPaths:freeze.files.length,realCalls:0,rows:[],pass:false};
const spec=JSON.parse(await fs.readFile('docs/reports/KB02-K204-PREP-AUDIT-20261023-spec.json','utf8'));
report.transitiveSpecFiles=spec.files;
for(const f of [...freeze.files,...spec.files,{path:freezePath,sha256:sha(bytes)}]){const b=await fs.readFile(f.path);assert.equal(sha(b),f.sha256,f.path);await fs.mkdir(path.dirname(path.join(root,f.path)),{recursive:true});await fs.writeFile(path.join(root,f.path),b);}
const args=['--import','tsx','tests/acceptance/KB02-K204-B-20261024-cli.mjs','selftest'];
const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const result=await new Promise(resolve=>{child.once('error',e=>resolve({error:e.message}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});await fs.writeFile(P+'selftest-'+stamp+'.log',output,{flag:'wx'});report.rows.push({name:'independent final-byte B selftest',args,...result});
report.artifacts=[];for(const file of await fs.readdir(path.join(root,'docs/reports')))if(/^KB02-K204-B-20261024-selftest-\d{4}-\d{2}-\d{2}T/.test(file)){const dest=P+'independent-'+file.slice('KB02-K204-B-20261024-'.length);await fs.copyFile(path.join(root,'docs/reports',file),dest);report.artifacts.push(dest);}
let f;
try{assert.equal(result.exitCode,0);process.chdir(root);const helper=await import(pathToFileURL(path.resolve('tests/acceptance/KB02-K204-B-20261024-selftest.mjs')));f=await helper.startFake();
 const before=await fs.readFile(path.join(f.lab.root,'session.json'),'utf8');await assert.rejects(f.lab.engine.provider(),/NO_RELEASE/);await assert.rejects(f.lab.engine.begin('B'),/NO_RELEASE/);assert.equal(await fs.readFile(path.join(f.lab.root,'session.json'),'utf8'),before);assert.equal(f.configReads(),0);assert.equal(f.requests.length,0);report.rows.push({name:'independent absent gate has no state/loader/send side effect',pass:true});
 await f.arm();await fs.mkdir(path.join(f.lab.root,'result-225.json'));const s=await f.lab.engine.load();await helper.call(f.lab,`/api/raw/${s.samples.B.rawId}/extract`,'POST',{},202);const failed=await helper.settled(f.lab);assert.equal(failed.stopped,true);assert.equal(f.requests.length,1);assert.equal((await f.lab.engine.attempts()).length,1);await assert.rejects(f.lab.engine.arm('B','absent','none'),/SESSION_STOPPED/);assert.equal(f.requests.length,1);report.rows.push({name:'independent successful response/result persistence failure stops at225',pass:true,fakeCalls:1,stopCode:failed.stopCode,root:f.lab.root});
 report.pass=true;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}finally{if(f)await f.close();process.chdir(repo);report.postMismatches=[];for(const item of freeze.files)if(sha(await fs.readFile(item.path))!==item.sha256)report.postMismatches.push(item.path);report.pass=report.pass&&!report.postMismatches.length;report.finishedAt=new Date().toISOString();await fs.writeFile(P+'engineering-execution-'+stamp+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
