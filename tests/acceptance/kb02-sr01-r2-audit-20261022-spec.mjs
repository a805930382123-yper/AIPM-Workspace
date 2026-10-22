import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {storageFixture} from '../support/kb02-storage-fixture.ts';
import {ExtractionJobStore} from '../../services/llm/jobs.ts';
import {readJsonFile,writeJsonAtomic} from '../../services/storage/files.ts';
const out={at:new Date().toISOString(),runtime:process.version,controlled:true,externalCalls:0,checks:[]};
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const sample=rawId=>({id:randomUUID(),rawId,status:'running',stage:'extracting',chunksTotal:1,chunksDone:0,pagesFound:0,provider:{name:'fake',model:'audit'},callCount:0,cancelRequested:false,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
async function check(id,fn){try{out.checks.push({id,result:'PASS',details:await fn()});}catch(e){out.checks.push({id,result:'FAIL',error:e.stack});}console.log(id,out.checks.at(-1).result);}
await check('canonical-case-dot-path-shares-real-read-lifetime',async()=>{
 const f=await storageFixture(),j=sample(f.raw.id),other=sample(f.raw.id),entered=gate(),held=gate();
 const file=path.join(f.root,'state/extraction-jobs',j.id+'.json');
 const alias=process.platform==='win32'?file.toUpperCase():path.join(f.root,'.','state/extraction-jobs',j.id+'.json');
 const read=fs.readFile,open=fs.open,rename=fs.rename;let armed=true,renames=0,reader,writer;
 try{
  await f.jobs.insert(j);
  fs.readFile=async(p,options)=>{if(String(p)!==alias||!armed)return read(p,options);armed=false;const h=await open(p,'r');try{const bytes=await h.readFile(options);entered.release();await held.promise;return bytes;}finally{await h.close();}};
  fs.rename=async(a,b)=>{if(path.resolve(String(b)).toLowerCase()===file.toLowerCase())renames++;return rename(a,b);};syncBuiltinESMExports();
  reader=readJsonFile(alias);await entered.promise;
  writer=new ExtractionJobStore(path.join(f.root,'.')).update(j.id,{callCount:9});
  await f.jobs.insert(other);assert.equal((await f.jobs.get(other.id)).id,other.id);await new Promise(r=>setImmediate(r));assert.equal(renames,0);
  held.release();await Promise.all([reader,writer]);assert.equal(renames,1);assert.equal((await f.jobs.get(j.id)).callCount,9);
  return {caseAlias:process.platform==='win32',renameBeforeClose:0,renameAfterClose:1,differentJobCompletedWhileHeld:true};
 }finally{held.release();await Promise.allSettled([reader,writer]);fs.readFile=read;fs.rename=rename;syncBuiltinESMExports();await f.clean();}
});
await check('failed-compound-mutation-releases-both-queues',async()=>{
 const f=await storageFixture(),j=sample(f.raw.id);try{
  await f.jobs.insert(j);const file=path.join(f.root,'state/extraction-jobs',j.id+'.json');await fs.writeFile(file,'{broken');
  await assert.rejects(f.jobs.update(j.id,{callCount:1}),{code:'STORAGE_CORRUPT'});
  await writeJsonAtomic(file,j);const other=new ExtractionJobStore(f.root);
  await Promise.all([f.jobs.update(j.id,{callCount:2}),other.update(j.id,{pagesFound:8})]);
  const result=await other.get(j.id);assert.equal(result.callCount,2);assert.equal(result.pagesFound,8);assert.equal(f.requests.length,0);
  return {mutationRejected:true,queuesUsableAfterFailure:true,crossStoreFieldsPreserved:true};
 }finally{await f.clean();}
});
out.closed=true;out.pass=out.checks.every(c=>c.result==='PASS');await fs.writeFile('docs/reports/KB02-SR01-R2-AUDIT-20261022-spec.json',JSON.stringify(out,null,2));if(!out.pass)process.exitCode=1;
