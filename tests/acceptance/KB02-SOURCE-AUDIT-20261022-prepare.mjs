import fs from 'node:fs/promises';
const old='KB02-PLAN-AUDIT-20261022',now='KB02-SOURCE-AUDIT-20261022';
for(const name of ['trace-hook','lab','real-http','browser-prepare','run','quality','update-check','final-evidence']){
 let s=await fs.readFile(`tests/acceptance/${old}-${name}.mjs`,'utf8');
 s=s.replaceAll(old,now).replaceAll('104+','126+').replaceAll('previousKB02:104','previousKB02:126').replaceAll('priorKB02:104','priorKB02:126').replaceAll('previousKB02Calls:104','previousKB02Calls:126').replaceAll('131+','153+').replaceAll('count>=30','count>=24').replaceAll('KB02-PLAN-20261022-sol-frozen.json','KB02-SOURCE-20261022-frozen.json');
 if(name==='trace-hook')s=s.replace("let sequence;", "const permit=JSON.parse(await fs.readFile('docs/reports/KB02-SOURCE-AUDIT-20261022-authorization.json','utf8'));if(permit.realCallsApproved!==true)throw Error('Independent real-call release not granted'); let sequence;");
 if(name==='run')s=s.replace("const frozen=", "const permit=JSON.parse(await fs.readFile(prefix+'authorization.json','utf8'));if(permit.engineeringApproved!==true)throw Error('Builder not frozen/released');\nconst frozen=");
 if(name==='lab')s=s.replace("const prefix=", "const permit=JSON.parse(await fs.readFile('docs/reports/KB02-SOURCE-AUDIT-20261022-authorization.json','utf8'));if(permit.realCallsApproved!==true)throw Error('Independent real-call release not granted');\nconst prefix=");
 await fs.writeFile(`tests/acceptance/${now}-${name}.mjs`,s,{flag:'wx'});
}
await fs.writeFile(`docs/reports/${now}-authorization.json`,JSON.stringify({at:new Date().toISOString(),engineeringApproved:false,realCallsApproved:false,priorKB02:126,totalCap:200,stageCap:24,prompt:'15/24',note:'Only main Agent release may enable; preparation is not execution authorization.'},null,2),{flag:'wx'});
console.log('Prepared gated independent tools. No product tests/services/real requests run. Browser execution will use cua_repl; historical standalone Playwright driver not copied. Diagnostic adapter awaits frozen v3 interface.');
