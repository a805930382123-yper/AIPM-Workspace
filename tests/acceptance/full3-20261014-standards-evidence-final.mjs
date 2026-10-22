import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(process.cwd());
const reportDir = path.join(root, 'docs/reports');
const output = path.join(reportDir, 'FULL3-20261014-standards-evidence-final.json');
const json = async name => JSON.parse(await fs.readFile(path.join(reportDir, name), 'utf8'));
const safeProduct = p => /^(app|server|services|rules|scripts)\//u.test(p) || ['package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html','.gitignore','.env.example'].includes(p);
const map = values => Array.isArray(values) ? Object.fromEntries(values.map(x => [x.path,x.sha256])) : values;
const latest = await json('CFG01-20261014-frozen.json');
const actual = {}, errors = [];
for (const [p,sha] of Object.entries(map(latest.product))) {
  if (!safeProduct(p)) { errors.push({path:p,reason:'not an allowed product path'}); continue; }
  actual[p] = crypto.createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex');
  if (actual[p] !== sha) errors.push({path:p,reason:'frozen mismatch'});
}
const tests = map(latest.tests ?? latest.test ?? {}), testErrors = [];
for (const [p,sha] of Object.entries(tests)) {
  if (!/^tests\//u.test(p)) { testErrors.push({path:p,reason:'not an allowed test path'}); continue; }
  const value = crypto.createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex');
  if (value !== sha) testErrors.push({path:p,reason:'frozen mismatch'});
}
const differences = async filename => { const older = map((await json(filename)).product); return Object.keys(older).filter(p => actual[p] !== older[p]); };
const matrix = await fs.readFile(path.join(root,'docs/delivery-matrix.md'),'utf8');
const rows = matrix.split(/\r?\n/u).filter(line => /^\| [AR]\d{2} \|/u.test(line)).map(line => { const c=line.split('|').map(v=>v.trim()); return {id:c[1],doc:c[3],run:c[4]}; });
const mhText = await fs.readFile(path.join(reportDir,'M05-20261012-spec-matrix.md'),'utf8');
const mhRows = mhText.split(/\r?\n/u).filter(line => /^\| MH\d{2} \|/u.test(line)).map(line => { const c=line.split('|').map(v=>v.trim()); return {id:c[1],result:c[3],limitation:c[5]}; });
const references = async (text,base) => {
 const refs=[...text.matchAll(/\]\(([^)]+)\)/gu)].map(m=>m[1]).filter(ref=>! /^[a-z]+:/iu.test(ref) && !ref.startsWith('#')), missing=[];
 for (const ref of new Set(refs)) { try { await fs.access(path.resolve(base,ref.split('#')[0])); } catch { missing.push(ref); } }
 return {uniqueReferenceCount:new Set(refs).size,missing};
};
const result = {
 at:new Date().toISOString(),scope:'Independent static Standards and evidence applicability only',hostModel:'Unknown; repository declarations cannot switch or identify the host model',
 providerInvoked:false,actualConfigRead:false,workspaceReadOrModified:false,
 product:{count:Object.keys(actual).length,errors,allMatchCFG01:errors.length===0},tests:{count:Object.keys(tests).length,errors:testErrors},
 changesFromM05:await differences('M05-20261012-frozen.json'),changesFromSEC:await differences('SEC-20261013-frozen.json'),
 matrix109:{count:rows.length,docPass:rows.filter(x=>x.doc==='PASS').length,runPass:rows.filter(x=>x.run==='PASS').length,runBlocked:rows.filter(x=>x.run==='BLOCKED').length,blockedIds:rows.filter(x=>x.run==='BLOCKED').map(x=>x.id),references:await references(matrix,path.join(root,'docs'))},
 meeting48:{count:mhRows.length,passWithinStatedLocalScope:mhRows.filter(x=>x.result.includes('PASS')).length,references:await references(mhText,reportDir),externalRemotePermissionNotRun:['MH07'],trueProviderQualityPending:['MH36','MH37']},
 notes:['Historical PASS is inherited only within original scope and after frozen-file applicability review.','36 real AI IDs remain pending main Agent live execution and semantic review; static review cannot sign them.','No build, npm test, server, browser or Provider operations executed by this reviewer.']
};
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
