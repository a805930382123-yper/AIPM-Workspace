import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { exportWorkspace, restoreWorkspace } from '../scripts/backup_workspace.ts';

const meetingId = 'abc12345-6789-4abc-8def-1234567890ab';
async function fixture<T>(work:(base:string)=>Promise<T>){const base=await mkdtemp(path.join(os.tmpdir(),'.meeting-minutes-backup-test-'));try{return await work(base);}finally{await rm(base,{recursive:true,force:true});}}

test('large meeting record exports as canonical base64 without regex stack overflow',async()=>fixture(async base=>{
 const source=path.join(base,'source');const records=path.join(source,'meetings');await mkdir(records,{recursive:true});
 const targetBytes=32*1024*1024;const prefix='{"minutes":"';const suffix='"}\n';const payload=Buffer.from(`${prefix}${'A'.repeat(targetBytes-Buffer.byteLength(prefix)-Buffer.byteLength(suffix))}${suffix}`,'utf8');
 const record=path.join(records,`${meetingId}.json`);await writeFile(record,payload);
 const archive=path.join(base,'meetings.backup.json');
 const exported=await exportWorkspace(source,archive);assert.equal(exported.files,1);assert.equal(exported.bytes,payload.length);assert.ok((await readFile(archive)).length>40*1024*1024);
 const decoded=JSON.parse(await readFile(archive,'utf8')) as {files:Array<{base64:string,size:number,sha256:string}>};assert.equal(decoded.files[0].size,payload.length);assert.equal(Buffer.from(decoded.files[0].base64,'base64').toString('base64'),decoded.files[0].base64);assert.equal(createHash('sha256').update(Buffer.from(decoded.files[0].base64,'base64')).digest('hex'),decoded.files[0].sha256);
}));

test('malformed base64 is rejected before creating a restore target',async()=>fixture(async base=>{
 const bytes=Buffer.from('bad encoding');const archive={format:'fmcg-workspace-backup',version:1,createdAt:'2026-10-11T00:00:00.000Z',files:[{path:`meetings/records/${meetingId}.json`,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:'%%%'}]};
 const input=path.join(base,'invalid.backup.json');const target=path.join(base,'target');await writeFile(input,JSON.stringify(archive));
 await assert.rejects(restoreWorkspace(input,target),/校验字段无效/);await assert.rejects(readFile(target));
}));
