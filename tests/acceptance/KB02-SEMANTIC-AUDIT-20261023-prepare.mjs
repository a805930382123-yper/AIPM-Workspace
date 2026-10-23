import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const name='KB02-SEMANTIC-AUDIT-20261023',p='docs/reports/'+name+'-',sha=b=>createHash('sha256').update(b).digest('hex');
async function files(dir){const out=[];try{for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.posix.join(dir,e.name);if(e.isDirectory())out.push(...await files(f));else if(e.isFile())out.push(f);}}catch(e){if(e.code!=='ENOENT')throw e;}return out;}
const snapshot=async paths=>Object.fromEntries(await Promise.all(paths.map(async f=>[f,sha(await fs.readFile(f))])));
const fixture=await fs.readFile(p+'fixtures.json');if(sha(fixture)!=='5cc5a6bdcb10738687e226bfca86e52a9a037ddad57d5eac492365c16745fbc5')throw Error('Fixture drift');
const protectedPaths=(await Promise.all(['docs/reports','tests/acceptance','workspace','config'].map(files))).flat().filter(f=>!path.basename(f).startsWith(name)&&!path.basename(f).startsWith('KB02-SEMANTIC-20261023'));
const config=(await fs.readdir('.')).filter(f=>/^\.env(?:\..*)?$/u.test(f));
const baseline={at:new Date().toISOString(),head:'0e44ab5563e5de3f4cdd8ed663a51393fde53422',phase:'pre-builder preparation; product/defaulttests deliberately not frozen while builder writes',protected:await snapshot([...protectedPaths,...config]),fixtureSha256:sha(fixture),excluded:['main-owned status/control/task','builder SEMANTIC prefix','own SEMANTIC-AUDIT prefix','product/defaulttests until builder freeze']};
await fs.writeFile(p+'baseline.json',JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});
await fs.writeFile(p+'authorization.json',JSON.stringify({engineeringApproved:false,realCallsApproved:false,priorKB02:203,totalCap:500,totalRoundCap:30,stageCaps:{1:6,2:20,3:4},activeStage:null,approvedStages:[],prompt:'15/24',note:'Main Agent releases frozen engineering and each real stage separately; no automatic retries.'},null,2)+'\n',{flag:'wx'});
let lab=await fs.readFile('tests/acceptance/KB02-REGION-AUDIT-20261023-lab.mjs','utf8');
lab=lab.replaceAll('KB02-REGION-AUDIT-20261023',name).replaceAll('kb02-region-audit-real-','kb02-semantic-audit-real-').replace('previousKB02Calls:183','previousKB02Calls:203');
await fs.writeFile('tests/acceptance/'+name+'-lab.mjs',lab,{flag:'wx'});
console.log(JSON.stringify({protected:Object.keys(baseline.protected).length,services:0,tests:0,realCalls:0}));
