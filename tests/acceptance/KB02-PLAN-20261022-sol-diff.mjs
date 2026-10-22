import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const prefix='KB02-PLAN-20261022-sol',scope=JSON.parse(await fs.readFile('docs/reports/'+prefix+'-scope.json','utf8'));let out='';
for(const p of scope.modified){const old='docs/reports/'+prefix+'-before-'+p.replaceAll('/','_'),r=spawnSync('git',['diff','--no-index','--',old,p],{encoding:'utf8',windowsHide:true});if(![0,1].includes(r.status))throw Error(r.stderr);out+=r.stdout;}
for(const p of scope.added){const r=spawnSync('git',['diff','--no-index','--','NUL',p],{encoding:'utf8',windowsHide:true});if(![0,1].includes(r.status))throw Error(r.stderr);out+=r.stdout;}
await fs.writeFile('docs/reports/'+prefix+'-exact.diff',out);console.log(JSON.stringify({files:scope.modified.length+scope.added.length,lines:out.split('\n').length}));
