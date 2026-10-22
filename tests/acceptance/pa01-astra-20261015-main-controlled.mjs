// Independent rerun: copied assertions unchanged; all data/providers belong to local fixtures.
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const prefix='docs/reports/PA01-ASTRA-20261015-main-', steps=[];
for (const name of ['probes','http','component','component-extended','edges','storage','security']) {
  const args=['--import','tsx','--import','./tests/support/css-stub.mjs',`tests/acceptance/pa01-astra-20261015-main-${name}.mjs`];
  const started=Date.now(),child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const [exitCode,signal]=await once(child,'exit');
  await fs.writeFile(prefix+name+'-run.log',output);
  const step={name,exitCode,signal,durationMs:Date.now()-started};steps.push(step);
  await fs.writeFile(prefix+'controlled-runs.json',JSON.stringify({at:new Date().toISOString(),externalCalls:0,steps},null,2));
  console.log(JSON.stringify(step));
}
if(steps.some(x=>x.exitCode!==0))process.exitCode=1;
