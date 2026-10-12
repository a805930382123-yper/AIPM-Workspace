// Actual isolated filesystem failures. Never affects paths outside FMCG_DATA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const root=process.env.FMCG_DATA_DIR,original={rename:fs.rename,writeFile:fs.writeFile,readFile:fs.readFile};
async function check(method,target){
 if(!root||!String(target).startsWith(root+path.sep))return;
 let f;try{f=JSON.parse(await original.readFile(path.join(root,'.b08-fault.json'),'utf8'));}catch{return;}
 if(f.method===method&&String(target).replaceAll('\\','/').includes(f.match)){
  await original.writeFile(path.join(root,'.b08-fault-observed.json'),JSON.stringify({method,target:String(target)}));
  const e=new Error('Independent B08 acceptance EIO');e.code='EIO';throw e;
 }
}
fs.rename=async(a,b)=>{await check('rename',b);return original.rename(a,b);};
fs.writeFile=async(a,...args)=>{await check('writeFile',a);return original.writeFile(a,...args);};
syncBuiltinESMExports();
