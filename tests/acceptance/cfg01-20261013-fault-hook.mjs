// Inject only into this acceptance harness's explicit configuration file, never real config.
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const root=process.env.FMCG_DATA_DIR,config=process.env.FMCG_LLM_CONFIG_FILE;
const original={readFile:fs.readFile,writeFile:fs.writeFile,rename:fs.rename};
async function fail(method,target){
 if(!root||!config||!path.resolve(config).startsWith(path.resolve(root)+path.sep))return;
 if(!String(target).includes(path.basename(config)))return;
 let fault;try{fault=JSON.parse(await original.readFile(path.join(root,'.cfg01-fault.json'),'utf8'));}catch{return;}
 if(fault.method!==method)return;
 await original.writeFile(path.join(root,'.cfg01-fault-observed.json'),JSON.stringify({method,observed:true}));
 if(fault.action==='external'&&method==='writeFile'){
  await original.writeFile(config,(await original.readFile(config,'utf8'))+'\n# EXTERNAL-EDIT-PRESERVED\n');return;
 }
 const e=new Error('Controlled isolated CFG01 EIO');e.code='EIO';throw e;
}
fs.readFile=async(a,...args)=>{await fail('readFile',a);return original.readFile(a,...args);};
fs.writeFile=async(a,...args)=>{await fail('writeFile',a);return original.writeFile(a,...args);};
fs.rename=async(a,b)=>{await fail('rename',b);return original.rename(a,b);};
syncBuiltinESMExports();
