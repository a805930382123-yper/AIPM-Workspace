import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/reports/B09-acceptance',base=prefix+'-baseline';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
const snap=names=>Promise.all(names.sort().map(async n=>({path:n.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(await fs.readFile(n)).digest('hex')})));
const read=async n=>JSON.parse(await fs.readFile(n,'utf8'));
const diff=(a,b)=>{const x=new Map(a.map(v=>[v.path,v.sha256])),y=new Map(b.map(v=>[v.path,v.sha256]));const changedPaths=[...new Set([...x.keys(),...y.keys()])].filter(p=>x.get(p)!==y.get(p));return{before:x.size,after:y.size,unchanged:!changedPaths.length,changedPaths};};
const candidates=[...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),...['package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html','README.md','docs/open-source-reuse.md','docs/delivery.md','docs/delivery-matrix.md']];const names=[];for(const n of candidates)if(await fs.access(n).then(()=>true,()=>false))names.push(n);const product=await snap(names),workspace=await snap(await files('workspace'));
const originals=['B04-http-evidence.json','B04-repair3-merge-payload.json'];
if(process.argv[2]==='baseline'){
 await fs.mkdir(base,{recursive:true});const hist=(await files('docs/reports')).filter(n=>!path.basename(n).startsWith('B09-')&&!n.includes('runtime'));const protectedNames=[...hist,...await files('THIRD_PARTY_LICENSES'),'AGENTS.md','docs/architecture.md','docs/coordination.md','docs/acceptance.md','docs/product-spec.md'];
 for(const [name,value] of Object.entries({product,workspace,historical:await snap(protectedNames),tests:await snap(await files('tests'))}))await fs.writeFile(base+'/'+name+'.json',JSON.stringify(value,null,2));for(const n of originals)await fs.copyFile('docs/reports/'+n,base+'/'+n);console.log({product:product.length,workspace:workspace.length,protected:protectedNames.length});
}else if(process.argv[2]==='restore'){
 for(const n of originals){await fs.copyFile('docs/reports/'+n,prefix+'-generated-'+(process.argv[3]??'run')+'-'+n);await fs.copyFile(base+'/'+n,'docs/reports/'+n);}console.log('Generated B04 outputs preserved; originals restored');
}else{
 const suffix=process.argv[3]?'-'+process.argv[3]:'';const history=await read(base+'/historical.json');const r={product:diff(await read(process.argv[2]==='freeze'?base+'/product.json':prefix+'-frozen'+suffix+'.json'),product),workspace:diff(await read(base+'/workspace.json'),workspace),historical:diff(history,await snap(history.map(v=>v.path)))};
 assert.ok(r.workspace.unchanged&&r.historical.unchanged);
 if(process.argv[2]==='freeze'){await fs.writeFile(prefix+'-frozen'+suffix+'.json',JSON.stringify(product,null,2));await fs.writeFile(prefix+'-delivery'+suffix+'.json',JSON.stringify(r,null,2));}
 else{assert.ok(r.product.unchanged);await fs.writeFile(prefix+'-final-integrity'+suffix+'.json',JSON.stringify(r,null,2));}console.log(JSON.stringify(r));
}
