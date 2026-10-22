import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const prefix='docs/reports/PA01-SOL-20261016-builder-',run=JSON.parse(await fs.readFile(prefix+'main-tests-writable-copy.json','utf8')),frozen=JSON.parse(await fs.readFile(prefix+'main-frozen.json','utf8'));
const mismatches=[];for(const [file,expected]of Object.entries({...frozen.product,...frozen.tests})){const hash=crypto.createHash('sha256').update(await fs.readFile(path.join(run.root,file))).digest('hex');if(hash!==expected)mismatches.push(file);}if(mismatches.length)throw Error('Build source/test snapshot mismatch');
const steps=[];for(const [name,args]of [['tsc',['node_modules/typescript/bin/tsc','-b']],['vite',['node_modules/vite/bin/vite.js','build']]]){const started=Date.now(),child=spawn(process.execPath,args,{cwd:run.root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const [code,signal]=await once(child,'exit');await fs.writeFile(prefix+name+'.log',output);steps.push({name,args,exitCode:code,signal,durationMs:Date.now()-started});if(code!==0)break;}
const out={at:new Date().toISOString(),root:run.root,copyMismatches:mismatches,steps,pass:steps.length===2&&steps.every(s=>s.exitCode===0),processesClosed:true};await fs.writeFile(prefix+'build.json',JSON.stringify(out,null,2));console.log(out);if(!out.pass)process.exitCode=1;
