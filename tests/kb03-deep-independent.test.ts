import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {deepFixture} from './support/kb03-deep-fixture.ts';
test('KB03 independent completed draft identity and mode cannot be silently reused',async()=>{
 const f=await deepFixture();try{
  const start=await f.start(),runtime=await f.wait(start.json.jobId),file=path.join(f.root,'drafts',runtime.job!.draftId!+'.json');
  const original=await readFile(file,'utf8'),record=JSON.parse(original),used=f.requests.length;
  for(const patch of [{jobId:randomUUID()},{rawSha256:'a'.repeat(64)},{extractionMode:'standard'}]){
   await writeFile(file,JSON.stringify({...record,...patch}));const response=await f.start();
   assert(response.status>=400,JSON.stringify(response));assert.equal(f.requests.length,used);
   assert.equal(await readFile(file,'utf8'),JSON.stringify({...record,...patch}));await writeFile(file,original);
  }
  assert.equal((await f.start('standard')).status,409);assert.equal(f.requests.length,used);
 }finally{await f.clean();}
});
