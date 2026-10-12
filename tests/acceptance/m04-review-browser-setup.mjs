import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const prefix='docs/reports/M04-review-20261012';
if(process.argv[2]==='lab'){
 const source=await fs.readFile('tests/acceptance/m03-lab.mjs','utf8');
 await fs.writeFile('tests/acceptance/m04-review-lab.mjs',source.replaceAll('M03','M04-review-20261012').replaceAll('m03','m04-review'));
 console.log('Isolated browser lab prepared');
}else{
 const lab=JSON.parse(await fs.readFile(prefix+'-browser-lab.json','utf8'));
 if(process.argv[2]==='shutdown'){await fs.writeFile(lab.controlFile,JSON.stringify({shutdown:true}));console.log('Shutdown requested');}
 else{
  const req=async(p,m='GET',body)=>{const r=await fetch(lab.api+p,{method:m,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('fixture HTTP '+r.status);return r.json();};
  const type=(await req('/api/meeting-catalog')).types[0].id;
  let a=await req('/api/meetings','POST',{requestId:randomUUID(),title:'M04删除保留Raw验收',meeting_date:'2026-10-12',meeting_type:type,confidentiality:'Public'});
  a=await req('/api/meetings/'+a.meeting_id+'/policy','PATCH',{baseRevision:a.revision,storage_mode:'local_archive',raw_transfer_authorized:true,confirm_raw_transfer:true});
  a=await req('/api/meetings/'+a.meeting_id+'/minutes/import','POST',{baseRevision:a.revision,requestId:randomUUID(),text:'# M04本机验收原件\n\n纯测试数据'});
  a=await req('/api/meetings/'+a.meeting_id+'/raw-links','POST',{baseRevision:a.revision,requestId:randomUUID(),import_id:a.active_import_id,confirm:true});
  await fs.writeFile(prefix+'-browser-fixture.json',JSON.stringify({meetingId:a.meeting_id,rawId:a.raw_id,url:lab.url,root:lab.root,revision:a.revision},null,2));console.log(JSON.stringify({meetingId:a.meeting_id,rawId:a.raw_id,url:lab.url}));
 }
}
