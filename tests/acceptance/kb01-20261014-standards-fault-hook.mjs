// Fault injection is scoped strictly to this test's explicitly isolated FMCG_DATA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const taskRoot=process.env.FMCG_DATA_DIR,original={rename:fs.rename,readFile:fs.readFile,writeFile:fs.writeFile},seen=new Map();
fs.rename=async(from,to)=>{
 if(taskRoot&&String(to).startsWith(taskRoot+path.sep)){
  let marker;try{marker=JSON.parse(await original.readFile(path.join(taskRoot,'.kb01-standards-fault.json'),'utf8'));}catch{}
  if(marker?.kind==='asset-link'&&/\/knowledge\/raw\/assets\/[0-9a-f-]+\.json$/i.test(String(to).replaceAll('\\','/'))){
   const n=(seen.get(String(to))??0)+1;seen.set(String(to),n);
   if(n===2){await original.writeFile(path.join(taskRoot,'.kb01-standards-fault-observed.json'),JSON.stringify({kind:'asset-link',target:String(to),attempt:n}));const error=new Error('Independent KB01 asset-link EIO');error.code='EIO';throw error;}
  }
 }
 return original.rename(from,to);
};
syncBuiltinESMExports();
