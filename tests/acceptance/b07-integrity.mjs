import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir='docs/reports', base=dir+'/B07-acceptance-baseline';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
async function snapshot(items){return Promise.all(items.sort().map(async p=>({path:p,sha256:crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')})));}
const productPaths=[...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),...['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html'].filter(p=>true)];
const existing=[];for(const p of productPaths)if(await fs.access(p).then(()=>true,()=>false))existing.push(p);
const product=await snapshot(existing),workspace=await snapshot(await files('workspace'));
const compare=(a,b)=>{const x=new Map(a.map(i=>[i.path,i.sha256])),y=new Map(b.map(i=>[i.path,i.sha256]));const changedPaths=[...new Set([...x.keys(),...y.keys()])].filter(p=>x.get(p)!==y.get(p));return{unchanged:!changedPaths.length,before:x.size,after:y.size,changedPaths};};
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const protectedNames=['B04-http-evidence.json','B04-repair3-merge-payload.json','B06-acceptance-http.json'];
if(process.argv[2]==='freeze'){
 await fs.mkdir(base,{recursive:true}); await fs.writeFile(dir+'/B07-acceptance-frozen.json',JSON.stringify(product,null,2)); await fs.writeFile(base+'/workspace.json',JSON.stringify(workspace,null,2));
 for(const n of protectedNames)await fs.copyFile(dir+'/'+n,base+'/'+n);
 await fs.copyFile(dir+'/B07-build.md',base+'/B07-build.md');
 const report=await fs.readFile(dir+'/B07-build.md','utf8');const claimed=[];for(const m of report.matchAll(/\| `([a-f0-9]{64})` \| \d+ \| `([^`]+)` \|/g)){const actual=crypto.createHash('sha256').update(await fs.readFile(m[2])).digest('hex');claimed.push({path:m[2],match:actual===m[1]});}
 await fs.writeFile(dir+'/B07-acceptance-delivery-checks.json',JSON.stringify({productFiles:product.length,claimed,formalMatchesB06:compare(await read(dir+'/B06-baseline/workspace-sha256.json'),workspace)},null,2));console.log(JSON.stringify({frozen:product.length,claimed:claimed.length,mismatches:claimed.filter(c=>!c.match)}));
}else if(process.argv[2]==='restore'){
 for(const n of protectedNames){await fs.copyFile(dir+'/'+n,dir+'/B07-acceptance-generated-'+n);await fs.copyFile(base+'/'+n,dir+'/'+n);}console.log('Historical evidence restored; fresh test outputs retained under B07 prefix');
}else{
 const result={product:compare(await read(dir+'/B07-acceptance-frozen.json'),product),workspace:compare(await read(base+'/workspace.json'),workspace),protected:[]};
 for(const n of protectedNames)result.protected.push({name:n,unchanged:(await fs.readFile(base+'/'+n)).equals(await fs.readFile(dir+'/'+n))});
 await fs.writeFile(dir+'/B07-acceptance-final-integrity.json',JSON.stringify(result,null,2));assert.ok(result.product.unchanged&&result.workspace.unchanged&&result.protected.every(p=>p.unchanged));console.log(JSON.stringify(result));
}
