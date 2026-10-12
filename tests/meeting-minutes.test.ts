import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import test from 'node:test';
import { MeetingError } from '../services/meeting/errors.ts';
import { MeetingStore } from '../services/meeting/store.ts';
import { meetingErrorMiddleware, registerMeetingMinutesRoutes, registerMeetingRoutes } from '../server/meeting-api.ts';

async function fixture<T>(work:(root:string,store:MeetingStore)=>Promise<T>){const root=await mkdtemp(path.join(process.cwd(),'.meeting-minutes-test-'));try{const store=new MeetingStore(root);await store.initialize();return await work(root,store);}finally{await rm(root,{recursive:true,force:true});}}
const ids=['89b5f66a-2460-4f1f-8ad3-404850a5b604','79b5f66a-2460-4f1f-8ad3-404850a5b604','69b5f66a-2460-4f1f-8ad3-404850a5b604','59b5f66a-2460-4f1f-8ad3-404850a5b604'];
async function publicLocal(store:MeetingStore){const c=await store.getCatalog();const {meeting}=await store.create({requestId:ids[0],title:'会议',meeting_date:'2026-10-11',meeting_type:c.types[0].id,confidentiality:'Public'});return await store.updatePolicy(meeting.meeting_id,{baseRevision:1,storage_mode:'local_archive'});}
async function code(work:()=>Promise<unknown>,expected:string){await assert.rejects(work,(e:unknown)=>e instanceof MeetingError&&e.code===expected);}

test('original text bytes survive BOM, CRLF, edits, reimport, and idempotent retries; clear tombstones old requests',async()=>fixture(async(root,store)=>{
 const meeting=await publicLocal(store);const original='\uFEFF# 原件\r\n\r\n正文  \r\n';const fileBytes=Buffer.from(original,'utf8');const fileSha=createHash('sha256').update(fileBytes).digest('hex');
 const first=await store.importMinutes(meeting.meeting_id,{baseRevision:meeting.revision,requestId:ids[1],text:original,original_filename:'中文.MD',file_sha256:fileSha});
 assert.equal(first.meeting.imports[0].imported_minutes,original);assert.equal(first.meeting.imports[0].editable_minutes,original);assert.equal(first.meeting.imports[0].original_filename,'中文.MD');assert.equal(first.meeting.imports[0].original_sha256,createHash('sha256').update(original,'utf8').digest('hex'));
 const retry=await store.importMinutes(meeting.meeting_id,{baseRevision:1,requestId:ids[1],text:original,original_filename:'中文.MD',file_sha256:fileSha});assert.equal(retry.reused,true);assert.equal(retry.meeting.imports.length,1);
 const edited=await store.updateEditableMinutes(meeting.meeting_id,first.imported.import_id,{baseRevision:first.meeting.revision,editable_minutes:'# 编辑\n'});assert.equal(edited.imports[0].imported_minutes,original);assert.equal(edited.imports[0].editable_minutes,'# 编辑\n');
 const second=await store.importMinutes(meeting.meeting_id,{baseRevision:edited.revision,requestId:ids[2],text:'新版本\n',confirmReimport:true});assert.equal(second.meeting.imports.length,2);assert.equal(second.meeting.active_import_id,second.imported.import_id);assert.equal(second.meeting.imports[0].editable_minutes,'# 编辑\n');
 await code(()=>store.updateEditableMinutes(meeting.meeting_id,first.imported.import_id,{baseRevision:second.meeting.revision,editable_minutes:'旧版本不可改'}),'MINUTES_VERSION_READ_ONLY');
 const record=path.join(root,'meetings','records',`${meeting.meeting_id}.json`);const persisted=JSON.parse(await readFile(record,'utf8'));assert.deepEqual(Object.keys(persisted.minute_requests[0]).sort(),['deleted','importId','inputSha256','requestId']);assert.equal(JSON.stringify(persisted.minute_requests).includes(original),false);
 const cleared=await store.clearMinutes(meeting.meeting_id,{baseRevision:second.meeting.revision,confirm:true});assert.equal(cleared.imports.length,0);assert.equal(cleared.active_import_id,null);await code(()=>store.importMinutes(meeting.meeting_id,{baseRevision:1,requestId:ids[1],text:original,original_filename:'中文.MD',file_sha256:fileSha}),'MINUTES_REQUEST_DELETED');
 const restored=new MeetingStore(root);const read=await restored.get(meeting.meeting_id);assert.equal(read?.imports.length,0);assert.ok(read?.minute_requests.every(x=>x.deleted));
}));

test('strict record validation verifies text digest, active version, policy, and request ledger links',async()=>fixture(async(root,store)=>{
 const meeting=await publicLocal(store);const imported=await store.importMinutes(meeting.meeting_id,{baseRevision:meeting.revision,requestId:ids[1],text:'original'});const file=path.join(root,'meetings','records',`${meeting.meeting_id}.json`);const good=JSON.parse(await readFile(file,'utf8'));
 for(const mutate of [(x:any)=>{x.imports[0].original_sha256='0'.repeat(64);},(x:any)=>{x.active_import_id='00000000-0000-4000-8000-000000000000';},(x:any)=>{x.minute_requests[0].deleted=true;},(x:any)=>{x.storage_mode='cloud_index';}]){const corrupt=structuredClone(good);mutate(corrupt);await writeFile(file,JSON.stringify(corrupt));await code(()=>store.get(meeting.meeting_id),'CORRUPT_MEETING');}
 await writeFile(file,JSON.stringify(good));assert.equal((await store.get(meeting.meeting_id))?.active_import_id,imported.imported.import_id);
}));

test('HTTP checks authorization before parsing, handles UTF-8 multipart names, and hides idempotency ledger',async()=>fixture(async(_root,store)=>{
 const app=express();registerMeetingMinutesRoutes(app,store);app.use(express.json());registerMeetingRoutes(app,store);app.use(meetingErrorMiddleware);
 const server=await new Promise<import('node:http').Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
   const catalog=await store.getCatalog();const denied=await store.create({requestId:ids[3],title:'云端会议',meeting_date:'2026-10-11',meeting_type:catalog.types[0].id,confidentiality:'Restricted'});const malformed=await fetch(`${base}/api/meetings/${denied.meeting.meeting_id}/minutes/import`,{method:'POST',headers:{'content-type':'application/json'},body:'{broken'});assert.equal(malformed.status,403);
   const meeting=await publicLocal(store);const form=new FormData();form.append('baseRevision',String(meeting.revision));form.append('requestId',ids[1]);form.append('file',new Blob([Buffer.from('\uFEFF# 标题\r\n','utf8')]),'中文.MD');const response=await fetch(`${base}/api/meetings/${meeting.meeting_id}/minutes/import`,{method:'POST',body:form});assert.equal(response.status,201);const detail=await response.json() as any;assert.equal(detail.imports[0].original_filename,'中文.MD');assert.equal(detail.imports[0].imported_minutes,'\uFEFF# 标题\r\n');assert.equal('minute_requests'in detail,false);
   const list=await fetch(`${base}/api/meetings`).then(r=>r.json()) as any;assert.equal('imports'in list.items[0],false);assert.equal('minute_requests'in list.items[0],false);
   const bad=new FormData();bad.append('baseRevision',String(detail.revision));bad.append('requestId',ids[2]);bad.append('file',new Blob([new Uint8Array([0xff,0xfe])]),'bad.md');const invalid=await fetch(`${base}/api/meetings/${meeting.meeting_id}/minutes/import`,{method:'POST',body:bad});assert.equal(invalid.status,415);assert.equal((await store.get(meeting.meeting_id))?.imports.length,1);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}));
