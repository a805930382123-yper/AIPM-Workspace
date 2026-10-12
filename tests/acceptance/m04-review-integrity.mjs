import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const prefix='docs/reports/M04-review-20261012';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).filter(e=>!e.isSymbolicLink()).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
const snap=async names=>Promise.all(names.sort().map(async p=>({path:p.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')})));
const product=async()=>[...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),'package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html'];
const unit=async()=>(await files('tests')).filter(p=>!p.includes(path.sep+'acceptance'+path.sep));
const originals=['B04-http-evidence.json','B04-repair3-merge-payload.json'];
if(process.argv[2]==='capture'){
 const names=[...(await files('docs/reports')).filter(p=>!path.basename(p).startsWith('M04-review-')), ...(await files('tests/acceptance')).filter(p=>!path.basename(p).startsWith('m04-review-')), 'AGENTS.md','docs/coordination.md','docs/product-spec.md','docs/meeting-hub/requirements.md','docs/meeting-hub/incremental-plan.md','THIRD_PARTY_LICENSES/react-markdown-MIT.txt'];
 const j={at:new Date().toISOString(),product:await snap(await product()),unit:await snap(await unit()),workspace:await snap(await files('workspace')),protected:await snap(names)};
 const prior=JSON.parse(await fs.readFile('docs/reports/M03-frozen.json','utf8'));
 j.comparison={reference:'M03-frozen.json',sourceCopiesAvailable:false,changed:[],added:[]};
 for(const [key,oldKey] of [['product','product'],['unit','unitTests']]){const old=new Map(prior[oldKey].map(x=>[x.path,x.sha256]));for(const f of j[key]){if(!old.has(f.path))j.comparison.added.push(f.path);else if(old.get(f.path)!==f.sha256)j.comparison.changed.push(f.path);}}
 await fs.mkdir(prefix+'-baseline',{recursive:true});for(const n of originals)await fs.copyFile('docs/reports/'+n,prefix+'-baseline/'+n);
 await fs.writeFile(prefix+'-baseline.json',JSON.stringify(j,null,2));console.log(JSON.stringify({counts:Object.fromEntries(['product','unit','workspace','protected'].map(k=>[k,j[k].length])),comparison:j.comparison}));
}else if(process.argv[2]==='restore'){
 for(const n of originals){await fs.copyFile('docs/reports/'+n,prefix+'-generated-'+n);await fs.copyFile(prefix+'-baseline/'+n,'docs/reports/'+n);}console.log('Historical outputs restored');
}else{
 const base=JSON.parse(await fs.readFile(prefix+'-baseline.json','utf8')),result={at:new Date().toISOString()};
 for(const k of ['product','unit','workspace','protected']){const names=k==='product'?await product():k==='unit'?await unit():k==='workspace'?await files('workspace'):base[k].map(x=>x.path);const now=await snap(names),m=new Map(now.map(x=>[x.path,x.sha256]));const changed=base[k].filter(x=>m.get(x.path)!==x.sha256).map(x=>x.path),added=now.filter(x=>!base[k].some(y=>y.path===x.path)).map(x=>x.path);result[k]={files:now.length,unchanged:!changed.length&&!added.length,changed,added};}
 await fs.writeFile(prefix+'-integrity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(['product','unit','workspace','protected'].some(k=>!result[k].unchanged))process.exitCode=1;
}
