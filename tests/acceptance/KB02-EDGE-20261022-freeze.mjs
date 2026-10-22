import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const name='KB02-EDGE-20261022',prefix='docs/reports/'+name+'-',sha=b=>createHash('sha256').update(b).digest('hex'),read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function files(d){let out=[];try{for(const e of await fs.readdir(d,{withFileTypes:true})){const p=path.posix.join(d,e.name);if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}}catch(e){if(e.code!=='ENOENT')throw e;}return out;}
async function snap(list){return Object.fromEntries(await Promise.all([...new Set(list)].map(async p=>[p,sha(await fs.readFile(p))])));}
async function changes(map){const out=[];for(const[p,h]of Object.entries(map)){try{if(sha(await fs.readFile(p))!==h)out.push(p);}catch{out.push(p);}}return out;}
const baseline=await read(prefix+'baseline.json'),prior=await read('docs/reports/KB02-SOURCE-20261022-frozen.json');
const product=await snap(Object.keys(baseline.product)),tests=await snap((await files('tests')).filter(p=>!p.startsWith('tests/acceptance/'))),fixtures=await snap([...Object.keys(prior.fixtures),`tests/acceptance/${name}-short-fixture.json`]),acceptanceScripts=await snap((await files('tests/acceptance')).filter(p=>path.basename(p).startsWith(name)&&/\.(?:mjs|mts|ts)$/u.test(p)));
const current={product,tests,fixtures,acceptanceScripts};
if(process.argv[2]==='freeze'){
 await fs.writeFile(prefix+'frozen.json',JSON.stringify({at:new Date().toISOString(),...current},null,2));
 console.log(JSON.stringify(Object.fromEntries(Object.entries(current).map(([k,v])=>[k,Object.keys(v).length]))));
}else if(process.argv[2]==='verify'){
 const frozen=await read(prefix+'frozen.json'),scope=await read(prefix+'scope.json'),report={at:new Date().toISOString()};
 for(const k of Object.keys(current))report[k]={changed:await changes(frozen[k]),added:Object.keys(current[k]).filter(p=>!Object.hasOwn(frozen[k],p))};
 const audit=p=>path.basename(p).startsWith('KB02-EDGE-AUDIT-20261022');
 const protectedMap=Object.fromEntries(Object.entries(baseline.protected).filter(([p])=>!audit(p)));
 report.protected={checked:Object.keys(protectedMap).length,changed:await changes(protectedMap),added:[...await files('docs/reports'),...await files('tests/acceptance'),...await files('workspace'),...await files('config')].filter(p=>!path.basename(p).startsWith(name)&&!audit(p)&&!Object.hasOwn(baseline.protected,p))};
 report.coordinatedAuditBaselineChanges=(await changes(baseline.protected)).filter(audit);
 report.coordinatedAuditAssets=(await files('tests/acceptance')).concat(await files('docs/reports')).filter(audit);
 report.workspace={changed:await changes(baseline.workspace),added:(await files('workspace')).filter(p=>!Object.hasOwn(baseline.workspace,p))};
 report.config={changed:await changes(baseline.config),added:(await fs.readdir('.')).filter(p=>/^\.env(?:\..*)?$/u.test(p)&&!Object.hasOwn(baseline.config,p))};
 report.baselineProductChanges=await changes(baseline.product);report.baselineTestChanges=await changes(baseline.tests);
 report.newTests=Object.keys(tests).filter(p=>!Object.hasOwn(baseline.tests,p));
 report.scopeExact=[...report.baselineProductChanges,...report.baselineTestChanges].sort().join('\n')===scope.modified.slice().sort().join('\n')&&report.newTests.sort().join('\n')===scope.addedTests.slice().sort().join('\n');
 report.pass=Object.values(report).filter(v=>v&&typeof v==='object'&&'changed'in v).every(v=>!v.changed.length&&!v.added.length)&&report.scopeExact;
 const stamp=report.at.replaceAll(':','-');await fs.writeFile(prefix+stamp+'-integrity.json',JSON.stringify(report,null,2));await fs.writeFile(prefix+'integrity.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1;
}else throw Error('mode');
