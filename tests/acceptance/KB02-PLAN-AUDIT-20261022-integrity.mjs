import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const prefix = 'KB02-PLAN-AUDIT-20261022';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
async function files(dir) { let out=[]; try { for(const e of await fs.readdir(dir,{withFileTypes:true})) {const p=path.posix.join(dir,e.name); if(e.isDirectory())out.push(...await files(p)); else if(e.isFile())out.push(p);} } catch(e){if(e.code!=='ENOENT')throw e;} return out; }
async function snapshot(list){return Object.fromEntries(await Promise.all([...new Set(list)].sort().map(async p=>[p,sha(await fs.readFile(p))])));}
const prior=JSON.parse(await fs.readFile('docs/reports/KB02-PLAN-20261022-sol-frozen.json','utf8'));
const baselinePath=`docs/reports/${prefix}-baseline.json`;
const product=Object.keys(prior.product),tests=(await files('tests')).filter(p=>!p.startsWith('tests/acceptance/'));
const protectedFiles=[...await files('docs/reports'),...await files('tests/acceptance'),...await files('workspace'),...await files('config')].filter(p=>!path.basename(p).startsWith(prefix));
const rootConfigs=(await fs.readdir('.',{withFileTypes:true})).filter(e=>e.isFile()&&(/^(?:\.env(?:\..*)?|package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\..*)$/.test(e.name))).map(e=>e.name);
const current={product:await snapshot(product),tests:await snapshot(tests),protected:await snapshot(protectedFiles),config:await snapshot(rootConfigs),workspace:await snapshot(await files('workspace'))};
if(process.argv[2]==='baseline') {await fs.writeFile(baselinePath,JSON.stringify({at:new Date().toISOString(),...current,mainAgentMutable:['docs/status.md','docs/agent-control.md','docs/coordination.md']},null,2)); console.log(JSON.stringify(Object.fromEntries(Object.entries(current).map(([k,v])=>[k,Object.keys(v).length]))));}
else if(process.argv[2]==='verify') {const base=JSON.parse(await fs.readFile(baselinePath,'utf8'));const out={at:new Date().toISOString()};for(const key of Object.keys(current)){out[key]={changed:Object.keys(base[key]).filter(p=>current[key][p]!==base[key][p]),added:Object.keys(current[key]).filter(p=>!Object.hasOwn(base[key],p))};}out.unchanged=Object.values(out).filter(v=>v&&typeof v==='object').every(v=>!v.changed.length&&!v.added.length);await fs.writeFile(`docs/reports/${prefix}-integrity.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(out));if(!out.unchanged)process.exitCode=1;}
else throw Error('baseline|verify');
