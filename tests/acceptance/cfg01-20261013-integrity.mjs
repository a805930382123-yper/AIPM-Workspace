import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd(), prefix='CFG01-20261013';
const baselineFile=path.join(root,'docs/reports',`${prefix}-baseline.json`);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function files(dir){let a=[];try{for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const p=path.posix.join(dir,e.name);if(e.isDirectory())a.push(...await files(p));else if(e.isFile())a.push(p);}}catch(e){if(e.code!=='ENOENT')throw e;}return a;}
async function snapshot(list){
 const pairs=await Promise.all(list.map(async p=>[p,sha(await fs.readFile(path.join(root,p)))]));
 return Object.fromEntries(pairs);
}
const productDirs=['app','server','services','rules','scripts'];
const productFiles=[...(await Promise.all(productDirs.map(files))).flat(),'package.json','package-lock.json','.env.example','.gitignore','vite.config.ts'];
async function actualConfig(){try{return {exists:true,sha256:sha(await fs.readFile(path.join(root,'.env.local')))};}catch(e){if(e.code!=='ENOENT')throw e;return {exists:false};}}
const oldOutputs=['docs/reports/B04-http-evidence.json','docs/reports/B04-repair3-merge-payload.json'];
const mode=process.argv[2];
if(mode==='baseline'){
 const protectedFiles=[...(await files('workspace')),...(await files('docs/reports')).filter(p=>!path.basename(p).startsWith(prefix)),...(await files('tests/acceptance')).filter(p=>!path.basename(p).startsWith('cfg01-20261013-'))];
 const saved={createdAt:new Date().toISOString(),actualConfig:await actualConfig(),product:await snapshot(productFiles),tests:await snapshot((await files('tests')).filter(p=>!p.startsWith('tests/acceptance/'))),protected:await snapshot(protectedFiles)};
 await fs.writeFile(baselineFile,JSON.stringify(saved,null,2));
 for(const p of oldOutputs)await fs.copyFile(path.join(root,p),path.join(root,'docs/reports',`${prefix}-original-${path.basename(p)}`));
 console.log(JSON.stringify({product:Object.keys(saved.product).length,tests:Object.keys(saved.tests).length,protected:Object.keys(saved.protected).length}));
}else if(mode==='freeze'){
 const saved={at:new Date().toISOString(),product:await snapshot(productFiles),tests:await snapshot((await files('tests')).filter(p=>!p.startsWith('tests/acceptance/')))};
 await fs.writeFile(path.join(root,'docs/reports',`${prefix}-frozen.json`),JSON.stringify(saved,null,2));console.log('Frozen');
}else if(mode==='restore'){
 for(const p of oldOutputs)await fs.copyFile(path.join(root,'docs/reports',`${prefix}-original-${path.basename(p)}`),path.join(root,p));console.log('Original B04 outputs restored');
}else if(mode==='verify'){
 const baseline=JSON.parse(await fs.readFile(baselineFile,'utf8'));const frozen=JSON.parse(await fs.readFile(path.join(root,'docs/reports',`${prefix}-frozen.json`),'utf8'));
 const changed=async data=>{const out=[];for(const [p,s]of Object.entries(data)){try{if(sha(await fs.readFile(path.join(root,p)))!==s)out.push(p);}catch{out.push(p);}}return out;};
 const result={at:new Date().toISOString(),protectedCount:Object.keys(baseline.protected).length,protectedChanges:await changed(baseline.protected),frozenProductChanges:await changed(frozen.product),frozenTestChanges:await changed(frozen.tests),productChangesFromBaseline:await changed(baseline.product)};
 result.actualConfigUnchanged=JSON.stringify(await actualConfig())===JSON.stringify(baseline.actualConfig);
 result.frozenProductAdded=productFiles.filter(p=>!Object.hasOwn(frozen.product,p));
 result.pass=!result.protectedChanges.length&&!result.frozenProductChanges.length&&!result.frozenTestChanges.length&&result.actualConfigUnchanged&&!result.frozenProductAdded.length;
 await fs.writeFile(path.join(root,'docs/reports',`${prefix}-integrity.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
}else throw new Error('mode required');
