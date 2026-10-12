// Root-owned evidence helper for the isolated actual browser lab only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const lab=JSON.parse(await fs.readFile('docs/reports/M02-browser-lab.json','utf8'));
assert(path.basename(lab.root).startsWith('fmcg-m02-browser-'));
const get=async p=>{const r=await fetch(lab.api+p);assert(r.ok);return r.json();};
const mode=process.argv[2],name=process.argv[3]||mode;
if(mode==='control'){
 await fs.writeFile(lab.controlFile,process.argv[3]);console.log('Isolated proxy control set');
}else if(mode==='fault'){
 await fs.writeFile(path.join(lab.root,'.b08-fault.json'),JSON.stringify({method:'rename',match:'/meetings/records/'}));console.log('Isolated actual EIO enabled');
}else if(mode==='unfault'){
 await fs.rm(path.join(lab.root,'.b08-fault.json'),{force:true});console.log('Isolated EIO cleared');
}else if(mode==='outside-patch'){
 const list=await get('/api/meetings'),a=list.items.find(x=>x.title==='M02验收渠道讨论');assert(a);
 const response=await fetch(lab.api+'/api/meetings/'+a.meeting_id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:a.revision,project:'外部改动项目'})});
 assert.equal(response.status,200);console.log('Isolated concurrent writer committed');
}else{
 const list=await get('/api/meetings'),catalog=await get('/api/meeting-catalog');
 const files=await fs.readdir(path.join(lab.root,'meetings','records'));
 const disk=await Promise.all(files.filter(n=>n.endsWith('.json')).sort().map(async n=>{const b=await fs.readFile(path.join(lab.root,'meetings','records',n));return {file:n,sha256:crypto.createHash('sha256').update(b).digest('hex'),value:JSON.parse(b)};}));
 const evidence={at:new Date().toISOString(),root:lab.root,list,catalog,disk};
 await fs.writeFile('docs/reports/M02-browser-'+name+'.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({name,items:list.items.map(x=>({id:x.meeting_id,title:x.title,revision:x.revision,level:x.confidentiality,mode:x.storage_mode})),diskFiles:disk.length}));
}
