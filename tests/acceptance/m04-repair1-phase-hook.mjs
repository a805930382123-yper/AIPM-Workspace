// Actual rename EIO only for the isolated meeting pending -> linked transition.
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const root=process.env.FMCG_DATA_DIR,rename=fs.rename;
fs.rename=async(a,b)=>{
 if(root&&String(b).startsWith(root+path.sep)&&String(b).replaceAll('\\','/').includes('/meetings/records/')){
  const marker=path.join(root,'.m04-linked-fault.json');let control;try{control=JSON.parse(await fs.readFile(marker,'utf8'));}catch{}
  if(control){const next=JSON.parse(await fs.readFile(a,'utf8'));if(next.meeting_id===control.meetingId&&next.raw_links.some(l=>l.status==='linked')){await fs.writeFile(path.join(root,'.m04-linked-fault-observed.json'),JSON.stringify({meetingId:next.meeting_id,rawId:next.raw_links.find(l=>l.status==='linked').raw_id,at:new Date().toISOString()}));await fs.rm(marker,{force:true});const e=new Error('Independent M04 linked commit EIO');e.code='EIO';throw e;}}
 }
 return rename(a,b);
};
syncBuiltinESMExports();
