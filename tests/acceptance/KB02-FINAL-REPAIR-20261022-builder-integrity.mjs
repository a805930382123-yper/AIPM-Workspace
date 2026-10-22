import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const prefix='KB02-FINAL-REPAIR-20261022-builder', sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function files(d){let out=[];try{for(const e of await fs.readdir(d,{withFileTypes:true})){const p=path.posix.join(d,e.name);if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}}catch(e){if(e.code!=='ENOENT')throw e;}return out;}
async function snap(list){return Object.fromEntries(await Promise.all(list.map(async p=>[p,sha(await fs.readFile(p))])));}
const prior=JSON.parse(await fs.readFile('docs/reports/KB02-FINAL-AUDIT-20261022-main-baseline.json','utf8'));
const products=Object.keys(prior.product),tests=(await files('tests')).filter(p=>!p.startsWith('tests/acceptance/'));
const protectedFiles=[...await files('workspace'),...(await files('docs/reports')).filter(p=>!path.basename(p).startsWith(prefix)),...(await files('tests/acceptance')).filter(p=>!path.basename(p).startsWith(prefix))];
let config={exists:false};try{config={exists:true,sha256:sha(await fs.readFile('.env.local'))};}catch(e){if(e.code!=='ENOENT')throw e;}
const mode=process.argv[2],basePath=`docs/reports/${prefix}-baseline.json`,freezePath=`docs/reports/${prefix}-frozen.json`;
if(mode==='baseline'||mode==='freeze'){
 const data={at:new Date().toISOString(),product:await snap(products),tests:await snap(tests),...(mode==='baseline'?{protected:await snap(protectedFiles),config,mainAgentMutable:['docs/status.md','docs/agent-control.md','docs/coordination.md']}:{fixtures:await snap(['tests/acceptance/kb02-r2-q01-20261018-builder-responses.json','tests/acceptance/kb02-r2-q02-20261018-builder-seq62.json',`tests/acceptance/${prefix}-failure-fixture.json`]),acceptanceScripts:await snap((await files('tests/acceptance')).filter(p=>path.basename(p).startsWith(prefix)&&p.endsWith('.mjs')))} )};
 await fs.writeFile(mode==='baseline'?basePath:freezePath,JSON.stringify(data,null,2));console.log(JSON.stringify({mode,product:products.length,tests:tests.length,protected:protectedFiles.length}));
}else if(mode==='verify'){
 const base=JSON.parse(await fs.readFile(basePath,'utf8')),frozen=JSON.parse(await fs.readFile(freezePath,'utf8'));
 async function changed(map){const a=[];for(const[p,h]of Object.entries(map)){try{if(sha(await fs.readFile(p))!==h)a.push(p);}catch{a.push(p);}}return a;}
 const out={at:new Date().toISOString(),productChanges:await changed(frozen.product),testChanges:await changed(frozen.tests),fixtureChanges:await changed(frozen.fixtures??{}),scriptChanges:await changed(frozen.acceptanceScripts??{}),protectedChanges:await changed(base.protected),workspaceAdded:(await files('workspace')).filter(p=>!Object.hasOwn(base.protected,p)),configAdded:(await files('config')).filter(p=>!Object.hasOwn(base.protected,p)),configUnchanged:JSON.stringify(config)===JSON.stringify(base.config),baselineProductDiff:await changed(base.product),baselineTestDiff:await changed(base.tests),testsAdded:tests.filter(p=>!Object.hasOwn(base.tests,p))};
 out.pass=!out.productChanges.length&&!out.testChanges.length&&!out.fixtureChanges.length&&!out.scriptChanges.length&&!out.protectedChanges.length&&!out.workspaceAdded.length&&!out.configAdded.length&&out.configUnchanged;
 await fs.writeFile(`docs/reports/${prefix}-integrity.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(out));if(!out.pass)process.exitCode=1;
}else throw Error('mode');
