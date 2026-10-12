import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/reports/B07-repair3-acceptance',base=prefix+'-baseline';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
async function snap(names){return Promise.all(names.sort().map(async name=>({path:name,sha256:hash(await fs.readFile(name))})));}
const read=async name=>JSON.parse(await fs.readFile(name,'utf8'));
const diff=(a,b)=>{const x=new Map(a.map(i=>[i.path,i.sha256])),y=new Map(b.map(i=>[i.path,i.sha256]));const changedPaths=[...new Set([...x.keys(),...y.keys()])].filter(p=>x.get(p)!==y.get(p));return{before:x.size,after:y.size,unchanged:!changedPaths.length,changedPaths};};
const prior=await read('docs/reports/B07-repair2-acceptance-frozen.json');
const productPaths=[...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),...['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html']];
const existing=[];for(const p of productPaths)if(await fs.access(p).then(()=>true,()=>false))existing.push(p);
const product=await snap(existing),workspace=await snap(await files('workspace'));
if(process.argv[2]==='freeze'){
 await fs.mkdir(base,{recursive:true});
 await fs.writeFile(prefix+'-frozen.json',JSON.stringify(product,null,2));await fs.writeFile(base+'/workspace.json',JSON.stringify(workspace,null,2));
 const names=(await files('docs/reports')).filter(n=>/^B07-(acceptance|repair[12]|fix-card|repair-build)/.test(path.basename(n))||['B04-http-evidence.json','B04-repair3-merge-payload.json','B06-acceptance-http.json'].includes(path.basename(n)));
 await fs.writeFile(base+'/protected.json',JSON.stringify(await snap(names),null,2));
 for(const n of ['B04-http-evidence.json','B04-repair3-merge-payload.json'])await fs.copyFile('docs/reports/'+n,base+'/'+n);
 const report=await fs.readFile('docs/reports/B07-repair3-build.md','utf8');await fs.writeFile(base+'/B07-repair3-build.md',report);
 const claims=[];for(const m of report.matchAll(/\| \[.*?\]\(\.\.\/\.\.\/(.*?)\) \| \d+ \| `([A-Fa-f0-9]{64})` \|/g))claims.push({path:m[1],match:hash(await fs.readFile(m[1]))===m[2].toLowerCase()});
 const delivery={product:diff(prior,product),claims,workspace:diff(await read('docs/reports/B07-repair2-acceptance-baseline/workspace.json'),workspace)};
 await fs.writeFile(prefix+'-delivery.json',JSON.stringify(delivery,null,2));assert.deepEqual(delivery.product.changedPaths.map(p=>p.replaceAll('\\','/')),['app/pages/PromptLibraryPage.tsx']);assert.ok(claims.length===5&&claims.every(c=>c.match)&&delivery.workspace.unchanged);console.log(JSON.stringify(delivery));
}else if(process.argv[2]==='restore'){
 for(const n of ['B04-http-evidence.json','B04-repair3-merge-payload.json']){await fs.copyFile('docs/reports/'+n,prefix+'-generated-'+n);await fs.copyFile(base+'/'+n,'docs/reports/'+n);}console.log('Historical B04 originals restored; new outputs retained');
}else{
 const protectedBefore=await read(base+'/protected.json');const result={product:diff(await read(prefix+'-frozen.json'),product),workspace:diff(await read(base+'/workspace.json'),workspace),historical:diff(protectedBefore,await snap(protectedBefore.map(i=>i.path)))};
 await fs.writeFile(prefix+'-final-integrity.json',JSON.stringify(result,null,2));assert.ok(result.product.unchanged&&result.workspace.unchanged&&result.historical.unchanged);console.log(JSON.stringify(result));
}

