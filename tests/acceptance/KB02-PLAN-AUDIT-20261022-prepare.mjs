import fs from 'node:fs/promises';
const old='KB02-FINAL-REPAIR-AUDIT-20261022',now='KB02-PLAN-AUDIT-20261022';
for(const name of ['trace-hook','lab','real-http','browser-prepare']){
 let s=await fs.readFile(`tests/acceptance/${old}-${name}.mjs`,'utf8');
 s=s.replaceAll(old,now).replaceAll('82+','104+').replaceAll('82+','104+').replaceAll('previousKB02:82','previousKB02:104').replaceAll('priorKB02:82','priorKB02:104').replaceAll('previousKB02Calls:82','previousKB02Calls:104').replaceAll('109+','131+');
 await fs.writeFile(`tests/acceptance/${now}-${name}.mjs`,s,{flag:'wx'});
}
let run=await fs.readFile('tests/acceptance/KB02-PLAN-20261022-sol-run.mjs','utf8');
run=run.replace("const prefix='docs/reports/KB02-PLAN-20261022-sol-'","const prefix='docs/reports/KB02-PLAN-AUDIT-20261022-'").replace("fs.readFile(prefix+'frozen.json'","fs.readFile('docs/reports/KB02-PLAN-20261022-sol-frozen.json'");
await fs.writeFile(`tests/acceptance/${now}-run.mjs`,run,{flag:'wx'});
let integ=await fs.readFile('tests/acceptance/KB02-PLAN-20261022-sol-integrity.mjs','utf8');
integ=integ.replace("const prefix = 'KB02-PLAN-20261022-sol'","const prefix = 'KB02-PLAN-AUDIT-20261022'").replace('KB02-FINAL-REPAIR-20261022-builder-frozen.json','KB02-PLAN-20261022-sol-frozen.json');
await fs.writeFile(`tests/acceptance/${now}-integrity.mjs`,integ,{flag:'wx'});
console.log('Prepared independent scripts with new evidence prefix and cumulative 104 budget baseline.');
