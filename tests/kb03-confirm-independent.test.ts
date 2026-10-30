import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {confirmFixture} from './support/kb03-confirm-fixture.ts';
test('KB03 independent note approval cannot be transplanted across drafts or forged through public mutations',async()=>{
 const a=await confirmFixture(),b=await confirmFixture();try{
  const approvedA=await a.review(),approvedB=await b.review();
  assert.notEqual(approvedA.noteApproval!.digest,approvedB.noteApproval!.digest);
  for(const endpoint of [`/api/drafts/${approvedB.id}`,`/api/drafts/${approvedB.id}/structured-note`]){
   const response=await fetch(b.http.base+endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:approvedB.revision,structuredNote:approvedB.structuredNote,noteApproval:approvedA.noteApproval})});assert.equal(response.status,400);
  }
  const forged={...approvedB,noteApproval:approvedA.noteApproval};await writeFile(path.join(b.root,'drafts',approvedB.id+'.json'),JSON.stringify(forged));
  await assert.rejects(b.wiki.withLock(()=>b.commits.confirm(b.input(forged))));assert.equal((await b.wiki.allRecords()).length,0);
 }finally{await a.clean();await b.clean();}
});
