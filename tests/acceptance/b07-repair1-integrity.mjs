import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const out='docs/reports/B07-repair1-acceptance',base=out+'-baseline';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function snapshot(paths){return Promise.all(paths.sort().map(async p=>({path:p,sha256:hash(await fs.readFile(p))})));}
const compare=(a,b)=>{const x=new Map(a.map(i=>[i.path,i.sha256])),y=new Map(b.map(i=>[i.path,i.sha256]));const changedPaths=[...new Set([...x.keys(),...y.keys()])].filter(p=>x.get(p)!==y.get(p));return{unchanged:!changedPaths.length,before:x.size,after:y.size,changedPaths};};
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const prior=await read('docs/reports/B07-acceptance-frozen.json');
const product=await snapshot(prior.map(x=>x.path)),workspace=await snapshot(await files('workspace'));
const protectedNames=['B04-http-evidence.json','B04-repair3-merge-payload.json','B06-acceptance-http.json','B07-acceptance-http.json','B07-acceptance-browser.json','B07-acceptance.md','B07-fix-card.md','B07-acceptance-final-integrity.json'];
if(process.argv[2]==='freeze'){
 await fs.mkdir(base,{recursive:true});await fs.writeFile(out+'-frozen.json',JSON.stringify(product,null,2));await fs.writeFile(base+'/workspace.json',JSON.stringify(workspace,null,2));
 for(const n of protectedNames)await fs.copyFile('docs/reports/'+n,base+'/'+n);
 const report=await fs.readFile('docs/reports/B07-repair-build.md','utf8');await fs.writeFile(base+'/B07-repair-build.md',report);
 const claims=[];for(const m of report.matchAll(/\| \[.*?\]\(\.\.\/\.\.\/(.*?)\) \| \d+ \| `([A-Fa-f0-9]{64})` \|/g))claims.push({path:m[1],match:hash(await fs.readFile(m[1]))===m[2].toLowerCase()});
 const delta=compare(prior,product);const formal=compare(await read('docs/reports/B07-acceptance-baseline/workspace.json'),workspace);
 await fs.writeFile(out+'-delivery-checks.json',JSON.stringify({delta,claims,formal},null,2));assert.ok(formal.unchanged&&claims.length===5&&claims.every(x=>x.match));console.log(JSON.stringify({delta,claims,formal}));
}else if(process.argv[2]==='restore'){
 for(const n of protectedNames.slice(0,2)){await fs.copyFile('docs/reports/'+n,out+'-generated-'+n);await fs.copyFile(base+'/'+n,'docs/reports/'+n);}console.log('B04 originals restored; new outputs retained with repair1 prefix');
}else{
 const result={product:compare(await read(out+'-frozen.json'),product),workspace:compare(await read(base+'/workspace.json'),workspace),protected:[]};
 for(const n of protectedNames)result.protected.push({name:n,unchanged:(await fs.readFile(base+'/'+n)).equals(await fs.readFile('docs/reports/'+n))});
 await fs.writeFile(out+'-final-integrity.json',JSON.stringify(result,null,2));assert.ok(result.product.unchanged&&result.workspace.unchanged&&result.protected.every(x=>x.unchanged));console.log(JSON.stringify(result));
}
