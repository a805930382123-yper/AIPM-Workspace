// Failpoints operate only below this test's temporary KB02 standards data root.
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const root=process.env.FMCG_DATA_DIR,original={rename:fs.rename,readFile:fs.readFile,writeFile:fs.writeFile};
const markerName='.kb02-standards-fault.json',seenName='.kb02-standards-fault-observed.json';
fs.rename=async(from,to)=>{
 if(root&&path.basename(root).startsWith('kb02-standards-')&&String(to).startsWith(root+path.sep)){
  let marker;try{marker=JSON.parse(await original.readFile(path.join(root,markerName),'utf8'));}catch{}
  const target=String(to).replaceAll('\\','/');
  if(marker?.kind==='crash-after-draft'&&/\/drafts\/[0-9a-f-]+\.json$/i.test(target)){
   const result=await original.rename(from,to);
   await original.writeFile(path.join(root,seenName),JSON.stringify({kind:marker.kind,target,afterRename:true}));
   process.exit(86);return result;
  }
 }
 return original.rename(from,to);
};
syncBuiltinESMExports();
