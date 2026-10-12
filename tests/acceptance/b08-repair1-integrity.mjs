import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/reports/B08-repair1-acceptance',initial='docs/reports/B08-acceptance';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
const snap=names=>Promise.all(names.sort().map(async n=>({path:n.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(await fs.readFile(n)).digest('hex')})));
const read=async n=>JSON.parse(await fs.readFile(n,'utf8'));
const diff=(a,b)=>{const x=new Map(a.map(v=>[v.path,v.sha256])),y=new Map(b.map(v=>[v.path,v.sha256]));return{before:x.size,after:y.size,unchanged:JSON.stringify([...x])===JSON.stringify([...y]),changedPaths:[...new Set([...x.keys(),...y.keys()])].filter(p=>x.get(p)!==y.get(p))};};
const product=await snap([...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),...['package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html']]);
const oldHistory=await read(initial+'-baseline/historical.json');
if(process.argv[2]==='protect'){
 const names=(await files('docs/reports')).filter(n=>path.basename(n).startsWith('B08-')&&!path.basename(n).startsWith('B08-repair1-'));
 await fs.writeFile(prefix+'-protected-initial.json',JSON.stringify(await snap(names),null,2));console.log({protectedInitial:names.length});
}else{
 const initialReports=await read(prefix+'-protected-initial.json');
 const r={product:diff(await read(process.argv[2]==='freeze'?initial+'-frozen.json':prefix+'-frozen.json'),product),workspace:diff(await read(initial+'-baseline/workspace.json'),await snap(await files('workspace'))),historical:diff(oldHistory,await snap(oldHistory.map(v=>v.path))),initialReports:diff(initialReports,await snap(initialReports.map(v=>v.path)))};
 assert.ok(r.workspace.unchanged&&r.historical.unchanged&&r.initialReports.unchanged);
 if(process.argv[2]==='freeze'){await fs.writeFile(prefix+'-frozen.json',JSON.stringify(product,null,2));await fs.writeFile(prefix+'-delivery.json',JSON.stringify(r,null,2));}
 else{assert.ok(r.product.unchanged);await fs.writeFile(prefix+'-final-integrity.json',JSON.stringify(r,null,2));}
 console.log(JSON.stringify(r));
}
