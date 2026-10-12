import fs from 'node:fs/promises';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.rename.bind(fs);let seen=0;
fs.rename=async(a,b)=>{
 const root=process.env.FMCG_DATA_DIR;
 if(root&&path.resolve(String(b))===path.join(path.resolve(root),'state','demo-manifest.json')){
  const marker=await fs.readFile(path.join(root,'.b09-demo-fault.json'),'utf8').then(JSON.parse,()=>null);
  if(marker&&++seen===marker.nth){await fs.writeFile(path.join(root,'.b09-demo-fault-observed.json'),JSON.stringify({method:'rename',target:String(b),seen}));throw Object.assign(new Error('B09 independent manifest EIO after asset commit'),{code:'EIO'});}
 }
 return rename(a,b);
};syncBuiltinESMExports();
