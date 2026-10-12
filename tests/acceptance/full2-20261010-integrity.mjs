import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const prefix='docs/reports/FULL2-20261010';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).filter(e=>!e.isSymbolicLink()).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
async function snap(names){return Promise.all(names.sort().map(async p=>({path:p.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')})));}
const originals=['B04-http-evidence.json','B04-repair3-merge-payload.json'];
if(process.argv[2]==='baseline'){
const product=await snap([...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),'package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html','README.md']);
const workspace=await snap(await files('workspace'));
const history=await snap((await files('docs/reports')).filter(p=>!p.includes('FULL2-20261010')));
await fs.mkdir(prefix+'-baseline',{recursive:true});
for(const n of originals)await fs.copyFile('docs/reports/'+n,prefix+'-baseline/'+n);
await fs.writeFile(prefix+'-baseline.json',JSON.stringify({at:new Date().toISOString(),product,workspace,history},null,2));console.log({product:product.length,workspace:workspace.length,history:history.length});
}else if(process.argv[2]==='restore'){
for(const n of originals){await fs.copyFile('docs/reports/'+n,prefix+'-generated-'+n);await fs.copyFile(prefix+'-baseline/'+n,'docs/reports/'+n);}console.log('Historical originals restored; new outputs retained');
}else{
const base=JSON.parse(await fs.readFile(prefix+'-baseline.json','utf8'));const result={};
for(const key of ['product','workspace','history']){const current=await snap(key==='workspace'?await files('workspace'):base[key].map(f=>f.path));const map=new Map(current.map(f=>[f.path,f.sha256]));const changes=base[key].filter(f=>map.get(f.path)!==f.sha256).map(f=>f.path);result[key]={files:current.length,unchanged:!changes.length&&current.length===base[key].length,changes};}
await fs.writeFile(prefix+'-integrity.json',JSON.stringify(result,null,2));console.log(result);
}

