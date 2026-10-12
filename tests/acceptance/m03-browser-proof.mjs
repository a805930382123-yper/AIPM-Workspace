// Isolated browser fixture controls and disk proof; browser itself is driven only via CUA.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileSnapshot} from './b08-harness.mjs';
const meta=JSON.parse(await fs.readFile('docs/reports/M03-browser-lab.json','utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const req=async(p,method='GET',body)=>{const r=await fetch(meta.api+p,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}if(!r.ok)throw Error(r.status+' '+text.slice(0,300));return data;};
const mode=process.argv[2],arg=process.argv[3];
if(mode==='fixtures'){
 const type=(await req('/api/meeting-catalog')).types[0].id;
 const make=(title,confidentiality)=>req('/api/meetings','POST',{requestId:randomUUID(),title,meeting_type:type,meeting_date:'2026-10-11',confidentiality});
 const A=await make('M03浏览器甲','Sensitive'),B=await make('M03浏览器乙','Public');
 const markdown='# 纪要标题\r\n\r\n- 事实一\r\n- 事实二\r\n\r\n> 引用原文\r\n\r\n```js\r\nconst n = 1;\r\n```\r\n\r\n[安全外链](https://example.com/m03)\r\n[危险脚本](javascript:alert(1))\r\n[危险数据](data:text/html,hello)\r\n![远程图片](https://example.com/m03-never-image.png)\r\n![本地陷阱图片]('+meta.proxy+'/m03-never-image)\r\n<script>alert("M03_SCRIPT")</script>\r\n<img src="'+meta.proxy+'/m03-never-html-image" onerror="alert(1)">\r\n';
 const uploadPath=path.resolve('docs/reports/M03-upload-fixture.md'),badPath=path.resolve('docs/reports/M03-invalid-fixture.md');
 await fs.writeFile(uploadPath,'\ufeff# 文件第二版\r\n\r\n上传保留尾部 \r\n');await fs.writeFile(badPath,Buffer.from([255,254,0]));
 const fixture={A:A.meeting_id,B:B.meeting_id,markdown,uploadPath,badPath};await fs.writeFile('docs/reports/M03-browser-fixture.json',JSON.stringify(fixture,null,2));console.log(JSON.stringify(fixture));
}else if(mode==='control'){
 const value=JSON.parse(arg||'{}');await fs.writeFile(meta.controlFile,JSON.stringify(value));console.log('Isolated proxy control applied');
}else if(mode==='delay-work'){
 const m=await req('/api/meetings/'+arg),p='/api/meetings/'+arg+'/minutes/'+m.active_import_id;await fs.writeFile(meta.controlFile,JSON.stringify({once:{method:'PATCH',path:p,delayMs:5000}}));console.log(JSON.stringify({delayPath:p,delayMs:5000}));
}else if(mode==='fault'){
 const f=path.join(meta.root,'.b08-fault.json');if(arg==='off')await fs.rm(f,{force:true});else await fs.writeFile(f,JSON.stringify({method:'rename',match:'/meetings/records/'}));console.log('Isolated filesystem fault '+arg);
}else if(mode==='external-edit'){
 const m=await req('/api/meetings/'+arg),next=await req('/api/meetings/'+arg,'PATCH',{baseRevision:m.revision,description:'独立外部并发更新'});console.log(JSON.stringify({meeting_id:next.meeting_id,revision:next.revision}));
}else{
 const list=(await req('/api/meetings')).items,records=[];
 for(const m of list){const bytes=await fs.readFile(path.join(meta.root,'meetings/records',m.meeting_id+'.json')),disk=JSON.parse(bytes),api=await req('/api/meetings/'+m.meeting_id);records.push({meeting_id:m.meeting_id,title:m.title,revision:m.revision,mode:m.storage_mode,level:m.confidentiality,localAuthorized:m.local_storage_authorized,capabilities:api.capabilities,fileSHA256:sha(bytes),active:disk.active_import_id,imports:disk.imports.map(v=>({id:v.import_id,originalSha256:sha(v.imported_minutes),storedSha256:v.original_sha256,workingSha256:sha(v.editable_minutes),originalChars:v.imported_minutes.length,workChars:v.editable_minutes.length,filename:v.original_filename})),ledgerCount:disk.minute_requests?.length??0,apiAndDiskImportsEqual:JSON.stringify(api.imports)===JSON.stringify(disk.imports)});}
 const out={at:new Date().toISOString(),records,files:await fileSnapshot(path.join(meta.root,'meetings')),oldRoots:Object.fromEntries(await Promise.all(['knowledge','prompts','drafts','state'].map(async p=>[p,await fileSnapshot(path.join(meta.root,p))])))};
 const name=arg||'current';await fs.writeFile('docs/reports/M03-browser-'+name+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}
