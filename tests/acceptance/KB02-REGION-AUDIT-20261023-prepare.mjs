import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const old='KB02-FIELDS-AUDIT-20261022',name='KB02-REGION-AUDIT-20261023',p='docs/reports/'+name+'-',base='tests/acceptance/';
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['run','trace-hook','lab','real-http','browser-prepare','quality','update-check','final-evidence','local-safety','browser','preview-review'];
for(const n of names){
 let s=(await fs.readFile(base+old+'-'+n+'.mjs','utf8')).replaceAll(old,name).replaceAll('KB02-FIELDS-20261022-frozen.json','KB02-REGION-20261023-frozen.json').replaceAll('kb02-fields-audit-','kb02-region-audit-').replaceAll('fields-browser-control','region-browser-control');
 // Budget changes are scoped to numeric tokens, never arbitrary substrings in fixtures.
 s=s.replace(/\b163\b/g,'183').replace(/\b164\b/g,'184').replace(/\b200\b/g,n==='trace-hook'||n==='lab'||n==='final-evidence'?'500':'200').replace('37-attempts','317-attempts');
 if(n==='run'){
  s=s.replace("targeted=['tests/kb02-planning-fields.test.ts'","targeted=['tests/kb02-planning-attribution.test.ts','tests/kb02-planning-fields.test.ts'");
  s=s.replaceAll(name+'-boundary.test.mjs',old+'-boundary.test.mjs').replaceAll(name+'-seq148-fixture.json',old+'-seq148-fixture.json');
  s=s.replace("const frozen=", "const frozen=");
 }
 if(n==='browser'){
  s=s.replace("import path from 'node:path';","import path from 'node:path';import os from 'node:os';");
  s=s.replace("'C:/Users/80593/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/entry.cjs'","path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/entry.cjs')");
  s=s.replace('assert.equal(await cards.count(),14);const all=[];for(let i=0;i<14;i++)','assert.equal(await cards.count(),a.longDraft.pages.length);const all=[];for(let i=0;i<a.longDraft.pages.length;i++)').replace('assert.equal(await cards.count(),14);','assert.equal(await cards.count(),a.longDraft.pages.length);');
 }
 if(n==='quality'){
  s=s.replace('assert.equal(a.longDraft.pages.length,14);assert.equal(cp.plan.pages.length,14);','assert.equal(a.longDraft.pages.length,cp.plan.pages.length);');
  s=s.replace("out.issues.push({title:p.title,areas,kind:'region-attribution',members})","out.issues.push({title:p.title,areas,kind:'requires-semantic-review',members})");
  s=s.replace("out.longPages.push({title:p.title,areas,facts:p.factIds.length,questions:p.questionIds.length,texts:[...new Set(members.map(m=>m.text))]})","out.longPages.push({title:p.title,areas,facts:p.factIds.length,questions:p.questionIds.length,members,texts:[...new Set(members.map(m=>m.text))]})");
  s=s.replace("out.supplementPages=","out.semanticDecision='PENDING independent review; page count and subject-title heuristics are not verdicts';out.boundaries=out.longPages.flatMap(page=>page.members.filter(m=>m.text.includes('异常审批负责人未知')).map(m=>({...m,owner:page.title,ownerAreas:page.areas,ownerTexts:page.texts})));out.supplementPages=");
 }
 await fs.writeFile(base+name+'-'+n+'.mjs',s,{flag:'wx'});
}
async function files(dir){let out=[];try{for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.posix.join(dir,e.name);if(e.isDirectory())out.push(...await files(f));else if(e.isFile())out.push(f);}}catch(e){if(e.code!=='ENOENT')throw e;}return out;}
const snap=async paths=>Object.fromEntries(await Promise.all([...new Set(paths)].map(async f=>[f,sha(await fs.readFile(f))])));
const prior=JSON.parse(await fs.readFile('docs/reports/KB02-REGION-DIAG-20261023-baseline.json','utf8')).protectedFiles;
const previousBase=JSON.parse(await fs.readFile('docs/reports/KB02-FIELDS-AUDIT-20261022-baseline.json','utf8'));
const product=Object.fromEntries(Object.keys(previousBase.product).map(f=>[f,prior[f]??previousBase.product[f]]));
const tests=Object.fromEntries(Object.entries(prior).filter(([f])=>f.startsWith('tests/')&&!f.startsWith('tests/acceptance/')));
const excludedPrefixes=[name,'KB02-REGION-20261023','KB02-REGION-PLAN-20261023'];
const protectedPaths=(await Promise.all(['docs/reports','tests/acceptance','workspace','config'].map(files))).flat().filter(f=>!excludedPrefixes.some(n=>path.basename(f).startsWith(n)));
const baseline={at:new Date().toISOString(),phase:'preparation; product/tests baseline inherited from verified pre-builder DIAG hashes',head:'5be06023bb8200e82cb0131b0588601632c4e941',productCommit:'a836270f53f0fc5bb802695e3f4101cf182ee3b9',excludedPrefixes,product,tests,protected:await snap(protectedPaths),workspace:await snap(await files('workspace')),config:await snap((await fs.readdir('.')).filter(f=>/^(\.env(?:\..*)?|package(?:-lock)?\.json|tsconfig\.json)$/u.test(f)))};
await fs.writeFile(p+'baseline.json',JSON.stringify(baseline,null,2),{flag:'wx'});
await fs.writeFile(p+'authorization.json',JSON.stringify({at:new Date().toISOString(),engineeringApproved:false,realCallsApproved:false,priorKB02:183,totalCap:500,stageCap:24,prompt:'15/24',note:'Main Agent separately releases frozen engineering then bounded real phases.'},null,2),{flag:'wx'});
console.log(JSON.stringify({scripts:names,product:Object.keys(product).length,tests:Object.keys(tests).length,protected:protectedPaths.length,workspace:Object.keys(baseline.workspace).length,config:Object.keys(baseline.config).length,servicesStarted:0,testsRun:0,realCalls:0}));
