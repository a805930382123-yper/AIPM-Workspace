import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const source=process.cwd();
const root=await fs.mkdtemp(path.join(os.tmpdir(),'fmcg-kb02-r1-builder-'));
for(const dir of ['app','server','services','rules','scripts','tests']) await fs.cp(path.join(source,dir),path.join(root,dir),{recursive:true});
for(const file of ['package.json','package-lock.json','.env.example','.gitignore','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html']){try{await fs.copyFile(path.join(source,file),path.join(root,file));}catch(error){if(error.code!=='ENOENT')throw error;}}
await fs.symlink(path.join(source,'node_modules'),path.join(root,'node_modules'),'junction');
const run=async(args)=>{const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const[code,signal]=await once(child,'exit');return{code,signal,output};};
const buildTypecheck=await run([path.join(root,'node_modules/typescript/bin/tsc'),'-b']);
const buildBundle=buildTypecheck.code===0?await run([path.join(root,'node_modules/vite/bin/vite.js'),'build']):{code:1,signal:null,output:'Skipped because tsc failed.'};
const build={code:buildTypecheck.code===0?buildBundle.code:buildTypecheck.code,signal:buildTypecheck.signal??buildBundle.signal,output:`[tsc -b]\n${buildTypecheck.output}\n[vite build]\n${buildBundle.output}`};
const selected=process.argv.slice(2);const testFiles=selected.length?selected:(await fs.readdir(path.join(root,'tests'))).filter(f=>f.endsWith('.test.ts')||f.endsWith('.test.tsx')).map(f=>'tests/'+f);
const tests=await run(['--import','tsx','--import','./tests/support/css-stub.mjs','--test',...testFiles]);
const prefix='docs/reports/KB02-R1-20261015-builder-';await fs.writeFile(path.join(source,prefix+(selected.length?'targeted':'tests')+'.log'),tests.output);await fs.writeFile(path.join(source,prefix+'build.log'),build.output);
const evidence={temporaryRoot:root,buildExitCode:build.code,testExitCode:tests.code,testFiles:testFiles.length,buildSummary:build.output.split(/\r?\n/u).filter(x=>/vite v|built in|error TS|error:/u.test(x)),testSummary:tests.output.split(/\r?\n/u).filter(x=>/^ℹ (tests|pass|fail|cancelled|skipped|todo|duration)/u.test(x)),logs:[prefix+(selected.length?'targeted':'tests')+'.log',prefix+'build.log']};await fs.writeFile(path.join(source,prefix+'verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));process.exitCode=build.code===0&&tests.code===0?0:1;