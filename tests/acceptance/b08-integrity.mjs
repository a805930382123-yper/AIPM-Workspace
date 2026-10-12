import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/reports/B08-acceptance',base=prefix+'-baseline';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
async function snap(names){return Promise.all(names.sort().map(async name=>({path:name.replaceAll('\\','/'),sha256:hash(await fs.readFile(name))})));}
const read=async n=>JSON.parse(await fs.readFile(n,'utf8'));
const diff=(a,b)=>{const x=new Map(a.map(i=>[i.path,i.sha256])),y=new Map(b.map(i=>[i.path,i.sha256]));const changedPaths=[...new Set([...x.keys(),...y.keys()])].filter(p=>x.get(p)!==y.get(p));return{before:x.size,after:y.size,unchanged:!changedPaths.length,changedPaths};};
const roots=['app','server','services','rules','scripts'];
const names=[...(await Promise.all(roots.map(files))).flat(),...['package.json','package-lock.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json','index.html']];
const existing=[];for(const n of names)if(await fs.access(n).then(()=>true,()=>false))existing.push(n);
const product=await snap(existing),workspace=await snap(await files('workspace'));
const originals=['B04-http-evidence.json','B04-repair3-merge-payload.json'];
if(process.argv[2]==='baseline'){
 await fs.mkdir(base,{recursive:true});
 await fs.writeFile(base+'/product.json',JSON.stringify(product,null,2));
 await fs.writeFile(base+'/workspace.json',JSON.stringify(workspace,null,2));
 const history=(await files('docs/reports')).filter(n=>!path.basename(n).startsWith('B08-')&&!n.includes('runtime'));
 await fs.writeFile(base+'/historical.json',JSON.stringify(await snap(history),null,2));
 await fs.writeFile(base+'/tests.json',JSON.stringify(await snap(await files('tests')),null,2));
 for(const n of originals)await fs.copyFile('docs/reports/'+n,base+'/'+n);
 console.log(JSON.stringify({products:product.length,workspace:workspace.length,historical:history.length}));
}else if(process.argv[2]==='restore'){
 for(const n of originals){await fs.copyFile('docs/reports/'+n,prefix+'-generated-'+n);await fs.copyFile(base+'/'+n,'docs/reports/'+n);}
 console.log('Restored original B04 evidence; saved generated outputs under B08 prefix');
}else{
 const history=await read(base+'/historical.json');
 const result={product:diff(await read(process.argv[2]==='freeze'?base+'/product.json':prefix+'-frozen.json'),product),workspace:diff(await read(base+'/workspace.json'),workspace),historical:diff(history,await snap(history.map(i=>i.path)))};
 assert.ok(result.workspace.unchanged&&result.historical.unchanged);
 if(process.argv[2]==='freeze'){
  await fs.writeFile(prefix+'-frozen.json',JSON.stringify(product,null,2));
  result.tests=diff(await read(base+'/tests.json'),await snap(await files('tests')));
  await fs.writeFile(prefix+'-delivery.json',JSON.stringify(result,null,2));
 }else{assert.ok(result.product.unchanged);await fs.writeFile(prefix+'-final-integrity.json',JSON.stringify(result,null,2));}
 console.log(JSON.stringify(result));
}
