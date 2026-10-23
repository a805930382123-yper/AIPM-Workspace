import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const prefix='docs/reports/KB02-HUMAN-CLOSE-20261023-'+(process.argv[2]?process.argv[2]+'-':''),sha=b=>createHash('sha256').update(b).digest('hex');
const previous=JSON.parse(await fs.readFile('docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json','utf8'));
const freeze=JSON.parse(await fs.readFile('docs/reports/KB02-HUMAN-20261023-freeze.json','utf8'));
const report={startedAt:new Date().toISOString(),node:process.version,head:freeze.head,freezePaths:freeze.files.length,previousSourcePaths:Object.keys(previous.expected).length,sourceMismatches:[],rows:[],realCalls:0};
for(const [file,hash]of Object.entries(previous.expected))if(sha(await fs.readFile(file))!==hash)report.sourceMismatches.push(file);
for(const f of freeze.files)assert.equal(sha(await fs.readFile(f.path)),f.sha256,f.path);
assert.deepEqual(report.sourceMismatches,[],'Previously tested source must match exactly');
const root=await fs.mkdtemp(path.resolve('.scratch-KB02-HUMAN-CLOSE-20261023-'));report.root=root;
async function copy(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await copy(file);else if(entry.isFile()){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.copyFile(file,path.join(root,file));}}}
for(const dir of ['app','server','services','rules','scripts','tests','docs'])await copy(dir);
for(const file of Object.keys(previous.expected).filter(f=>!f.includes('/')))await fs.copyFile(file,path.join(root,file));
for(const [file,hash]of Object.entries(previous.expected))assert.equal(sha(await fs.readFile(path.join(root,file))),hash,file);
const probe='tests/acceptance/KB02-HUMAN-CLOSE-20261023-http-ui.mjs';
await fs.writeFile(path.join(root,probe),(await fs.readFile('tests/acceptance/KB02-HUMAN-AUDIT-20261023-http-ui.mjs','utf8')).replace("const prefix='docs/reports/KB02-HUMAN-AUDIT-20261023-';",`const prefix='${prefix}';`));
async function run(name,args){const start=Date.now();const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const result=await new Promise(resolve=>{child.once('error',e=>resolve({error:e.message}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});await fs.writeFile(prefix+name+'.log',output);report.rows.push({name,command:[process.execPath,...args],...result,durationMs:Date.now()-start});await fs.writeFile(prefix+'execution.json',JSON.stringify(report,null,2)+'\n');}
await run('core',['--import','tsx','--import','./tests/support/css-stub.mjs','--test','tests/kb02-human-review.test.ts','tests/kb02-human-ui.test.tsx']);
await run('http-ui',['--import','tsx','--import','./tests/support/css-stub.mjs',probe]);
try{await fs.copyFile(path.join(root,prefix+'http-ui.json'),prefix+'http-ui.json');}catch(e){report.httpReportError=e.code;}
report.postMismatches=[];for(const [file,hash]of Object.entries(previous.expected))if(sha(await fs.readFile(file))!==hash)report.postMismatches.push(file);
report.finishedAt=new Date().toISOString();report.pass=report.rows.every(x=>x.exitCode===0)&&!report.postMismatches.length&&!report.httpReportError;
await fs.writeFile(prefix+'execution.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
