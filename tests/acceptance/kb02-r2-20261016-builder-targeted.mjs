import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const source=process.cwd(),root=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-kb02-r2-targeted-')),label=process.env.KB02_RUN_LABEL??'initial';
for(const dir of ['app','server','services','rules','scripts','tests'])await fs.cp(path.join(source,dir),path.join(root,dir),{recursive:true});
for(const file of ['package.json','package-lock.json','.env.example','.gitignore','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html']){try{await fs.copyFile(path.join(source,file),path.join(root,file));}catch(e){if(e.code!=='ENOENT')throw e;}}
await fs.mkdir(path.join(root,'docs','reports'),{recursive:true});
await fs.symlink(path.join(source,'node_modules'),path.join(root,'node_modules'),'junction');
const hashes={};for(const dir of ['app','server','services','rules','tests']){async function walk(base){for(const e of await fs.readdir(path.join(source,base),{withFileTypes:true})){const p=path.join(base,e.name);if(e.isDirectory()){if(e.name!=='acceptance')await walk(p);}else{const a=await fs.readFile(path.join(source,p)),b=await fs.readFile(path.join(root,p));if(!a.equals(b))throw Error('Copy mismatch '+p);hashes[p]=crypto.createHash('sha256').update(a).digest('hex');}}}await walk(dir);}
const args=['--import','tsx','--import','./tests/support/css-stub.mjs','--test',...process.argv.slice(2)];
const start=Date.now(),child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const [code,signal]=await once(child,'exit');
const prefix=path.join(source,'docs','reports',`KB02-R2-20261016-builder-targeted-${label}`);await fs.writeFile(prefix+'.log',output);const result={root,args,code,signal,durationMs:Date.now()-start,hashes,summary:output.split(/\r?\n/).filter(x=>/^ℹ (tests|pass|fail|cancelled|skipped|todo|duration)/u.test(x))};await fs.writeFile(prefix+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify({root,code,summary:result.summary}));process.exitCode=code??1;
