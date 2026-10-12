import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const prefix='docs/reports/M03';
async function files(root){return(await Promise.all((await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).filter(e=>!e.isSymbolicLink()).map(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]))).flat();}
const snap=async names=>Promise.all(names.sort().map(async p=>({path:p.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex')})));
const originals=['B04-http-evidence.json','B04-repair3-merge-payload.json'];
const productFiles=async()=>[...(await Promise.all(['app','server','services','rules','scripts'].map(files))).flat(),'package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html'];
const mode=process.argv[2];
if(mode==='baseline'){
 const protectedFiles=[...(await files('docs/reports')).filter(p=>!path.basename(p).startsWith('M03')), ...(await files('tests/acceptance')).filter(p=>!path.basename(p).startsWith('m03')&&!path.basename(p).startsWith('M03')), ...(await files('THIRD_PARTY_LICENSES')), 'AGENTS.md','docs/product-spec.md','docs/coordination.md','docs/meeting-hub/requirements.md','docs/meeting-hub/incremental-plan.md','docs/meeting-hub/project-check.md'];
 const baseline={at:new Date().toISOString(),product:await snap(await productFiles()),workspace:await snap(await files('workspace')),protected:await snap(protectedFiles),unitTests:await snap((await files('tests')).filter(p=>!p.includes(path.sep+'acceptance'+path.sep)))};
 await fs.mkdir(prefix+'-baseline',{recursive:true});for(const n of originals)await fs.copyFile('docs/reports/'+n,prefix+'-baseline/'+n);
 await fs.writeFile(prefix+'-baseline.json',JSON.stringify(baseline,null,2));console.log(JSON.stringify(Object.fromEntries(['product','workspace','protected','unitTests'].map(k=>[k,baseline[k].length]))));
}else if(mode==='restore'){
 for(const n of originals){await fs.copyFile('docs/reports/'+n,prefix+'-generated-'+n);await fs.copyFile(prefix+'-baseline/'+n,'docs/reports/'+n);}console.log('Historical B04 outputs restored; new outputs saved');
}else if(mode==='freeze'){
 await fs.writeFile(prefix+'-frozen.json',JSON.stringify({product:await snap(await productFiles()),unitTests:await snap((await files('tests')).filter(p=>!p.includes(path.sep+'acceptance'+path.sep)))},null,2));console.log('M03 product and unit tests frozen');
}else{
 const base=JSON.parse(await fs.readFile(prefix+'-baseline.json','utf8')), frozen=JSON.parse(await fs.readFile(prefix+'-frozen.json','utf8')), result={};
 for(const key of ['product','unitTests','workspace','protected']){
  const names=key==='product'?await productFiles():key==='unitTests'?(await files('tests')).filter(p=>!p.includes(path.sep+'acceptance'+path.sep)):key==='workspace'?await files('workspace'):base.protected.map(x=>x.path);
  const now=await snap(names),ref=key==='product'||key==='unitTests'?frozen[key]:base[key],map=new Map(now.map(x=>[x.path,x.sha256])),changed=ref.filter(x=>map.get(x.path)!==x.sha256).map(x=>x.path),added=now.filter(x=>!ref.some(y=>y.path===x.path)).map(x=>x.path);
  result[key]={files:now.length,unchanged:!changed.length&&!added.length,changed,added};
  if(key==='product'||key==='unitTests'){result[key].changesFromBaseline=base[key].filter(x=>map.get(x.path)!==x.sha256).map(x=>x.path);result[key].addedFromBaseline=now.filter(x=>!base[key].some(y=>y.path===x.path)).map(x=>x.path);}
 }
 await fs.writeFile(prefix+'-integrity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(Object.values(result).some(x=>!x.unchanged))process.exitCode=1;
}

