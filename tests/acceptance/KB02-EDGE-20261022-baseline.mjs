import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const prefix='KB02-EDGE-20261022',sha=b=>createHash('sha256').update(b).digest('hex');
async function files(dir){let out=[];try{for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.posix.join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}}catch(e){if(e.code!=='ENOENT')throw e;}return out;}
const snap=async paths=>Object.fromEntries(await Promise.all([...new Set(paths)].map(async p=>[p,sha(await fs.readFile(p))])));
const old=JSON.parse(await fs.readFile('docs/reports/KB02-SOURCE-20261022-frozen.json','utf8'));
const excluded=p=>path.basename(p).startsWith(prefix)||path.basename(p).startsWith('KB02-EDGE-AUDIT-20261022');
const product=await snap(Object.keys(old.product)),tests=await snap((await files('tests')).filter(p=>!p.startsWith('tests/acceptance/'))),protectedFiles=(await Promise.all(['docs/reports','tests/acceptance','workspace','config'].map(files))).flat().filter(p=>!excluded(p));
const config=await snap((await fs.readdir('.')).filter(p=>/^(\.env(?:\..*)?|package(?:-lock)?\.json|tsconfig\.json)$/u.test(p)));
const result={at:new Date().toISOString(),head:'024fbbeebc6724da7a3ba164c8715b5de3536f3c',phase:'diagnosis only; no product/default test edits',excludedPrefixes:[prefix,'KB02-EDGE-AUDIT-20261022'],product,tests,protected:await snap(protectedFiles),workspace:await snap(await files('workspace')),config};
await fs.writeFile(`docs/reports/${prefix}-baseline.json`,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({product:Object.keys(product).length,tests:Object.keys(tests).length,protected:protectedFiles.length,workspace:Object.keys(result.workspace).length,config:Object.keys(config).length}));
