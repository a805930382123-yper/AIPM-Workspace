import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import test from 'node:test';
import { MeetingStore } from '../services/meeting/store.ts';
import { meetingErrorMiddleware, registerMeetingMinutesRoutes, registerMeetingRoutes } from '../server/meeting-api.ts';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';

test('multiline metadata, four original files, failure and restored bytes', async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'meeting-input-'));const root=path.join(temp,'source');const store=new MeetingStore(root);await store.initialize();
 const app=express();registerMeetingMinutesRoutes(app,store);app.use(express.json());registerMeetingRoutes(app,store);app.use(meetingErrorMiddleware);
 const server=await new Promise<import('node:http').Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try { const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;const type=(await store.getCatalog()).types[0].id;
 let {meeting}=await store.create({requestId:randomUUID(),title:'会议',meeting_date:'2026-10-30',meeting_type:type,description:'第一行\r\n第二行\t内容\n第三行',confidentiality:'Public'});assert.equal((await new MeetingStore(root).get(meeting.meeting_id))?.description,'第一行\r\n第二行\t内容\n第三行');
 await assert.rejects(store.update(meeting.meeting_id,{baseRevision:meeting.revision,description:'错误\0'})); await assert.rejects(store.update(meeting.meeting_id,{baseRevision:meeting.revision,title:'错误\n标题'}));
 meeting=await store.updatePolicy(meeting.meeting_id,{baseRevision:meeting.revision,storage_mode:'local_archive'});const id=meeting.meeting_id;
 const files=[['bom.md',Buffer.from('\uFEFF第一行\r\n尾空格  \r\n')],['zh.txt',Buffer.from('中文纪要\r\n')],['zh-report.docx',await readFile('tests/fixtures/b03/zh-report.docx')],['zh-report.pdf',await readFile('tests/fixtures/b03/zh-report.pdf')]] as const;
 const versions:string[]=[];
 for(const [name,bytes] of files){const form=new FormData();form.append('file',new Blob([bytes]),name);form.append('baseRevision',String(meeting.revision));form.append('requestId',randomUUID());if(versions.length)form.append('confirmReimport','true');const response=await fetch(`${base}/api/meetings/${id}/minutes/import`,{method:'POST',body:form});assert.equal(response.status,201,await response.clone().text());const body=await response.json() as any; meeting=body;const v: {import_id:string; imported_minutes:string; file_base64?:string}=body.imported;versions.push(v.import_id);assert.ok(v.imported_minutes.trim());if(name==='bom.md')assert.equal(v.imported_minutes,'\uFEFF第一行\r\n尾空格  \r\n');assert.equal(v.file_base64,undefined);const downloaded=Buffer.from(await (await fetch(`${base}/api/meetings/${id}/minutes/${v.import_id}/file`)).arrayBuffer());assert.deepEqual(downloaded,bytes);}
 const original = (await store.get(id))!.imports[3];
 meeting=await store.updateEditableMinutes(id,original.import_id,{baseRevision:meeting.revision,editable_minutes:'修改工作副本'});
 assert.equal((await store.get(id))!.imports[3].imported_minutes,original.imported_minutes);
 assert.equal((await store.get(id))!.imports[3].file_sha256,original.file_sha256);
 const denied=await store.create({requestId:randomUUID(),title:'未授权',meeting_date:'2026-10-30',meeting_type:type,confidentiality:'Sensitive'});
 const deniedForm=new FormData();deniedForm.append('file',new Blob([files[2][1]]),'zh-report.docx');deniedForm.append('baseRevision','1');deniedForm.append('requestId',randomUUID());
 assert.equal((await fetch(`${base}/api/meetings/${denied.meeting.meeting_id}/minutes/import`,{method:'POST',body:deniedForm})).status,403);
 const bad=new FormData();bad.append('file',new Blob([await readFile('tests/fixtures/b03/broken.pdf')]),'broken.pdf');bad.append('baseRevision',String(meeting.revision));bad.append('requestId',randomUUID());bad.append('confirmReimport','true');assert.ok((await fetch(`${base}/api/meetings/${id}/minutes/import`,{method:'POST',body:bad})).status>=400);assert.equal((await store.get(id))?.imports.length,4);
 const archive=path.join(temp,'archive.json'),restored=path.join(temp,'restored');await exportWorkspace(root,archive);await restoreWorkspace(archive,restored);const read=await new MeetingStore(restored).get(id);assert.equal(read?.description,'第一行\r\n第二行\t内容\n第三行');for(let i=0;i<files.length;i++){const v: import("../services/meeting/types.ts").MeetingMinuteVersion=read!.imports[i];assert.equal(createHash('sha256').update(Buffer.from(v.file_base64!,'base64')).digest('hex'),createHash('sha256').update(files[i][1]).digest('hex'));}
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(temp,{recursive:true,force:true});}
});


