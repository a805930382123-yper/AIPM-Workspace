import assert from 'node:assert/strict';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWeeklyFixture, formalHashes } from './review01-review-fixture.mjs';
import { startWeeklyService } from './review01-review-service.mjs';

const [mode,source,approved]=process.argv.slice(2);
assert(['fake','real'].includes(mode));
let f;
if(mode==='fake'){
  f=await createWeeklyFixture();
  await cp(f.data,path.join(f.run,'template'),{recursive:true});
  await writeFile(path.join(f.run,'fixture.json'),JSON.stringify(f));
}else{
  const run=await realpath(source);
  assert.equal(path.dirname(run).toLowerCase(),(await realpath(os.tmpdir())).toLowerCase());
  assert(path.basename(run).startsWith('review01-accept-'));
  assert(/^[0-9a-f]{64}$/.test(approved));
  f=JSON.parse(await readFile(path.join(run,'fixture.json'),'utf8'));f.data=path.join(run,'real-data');
  await cp(path.join(run,'template'),f.data,{recursive:true,errorOnExist:true,force:false});
  await writeFile(path.join(run,'approved-envelope.sha256'),approved,{flag:'wx'});
}
console.log('Evidence',f.run);
const srv=await startWeeklyService(f,mode,path.resolve('tests/acceptance/review01-review-guard.mjs'));
const observed={node:process.version,weekKey:f.weekKey,mode};
try {
  const before=await formalHashes(f.data);assert.deepEqual(before,f.protectedHashes);
  const job=await srv.run();
  Object.assign(observed,{job:job.id,status:job.status,usage:job.usage,steps:job.steps.map(s=>({name:s.name,status:s.status,summary:s.summary}))});
  const doc=await srv.json('/api/automation/weekly-reviews/'+f.weekKey);
  observed.aiStatus=doc.aiStatus;observed.revision=doc.revision;observed.aiError=doc.aiError;
  const saved=JSON.stringify(doc);
  for(const s of f.forbidden) assert(!saved.includes(s),'private fixture value persisted in weekly file');
  assert.deepEqual(await formalHashes(f.data),before);observed.protectedFileCount=Object.keys(before).length;observed.protectedUnchanged=true;
  await writeFile(path.join(f.run,mode+'-weekly.json'),JSON.stringify(doc,null,2));
  assert.equal(doc.aiStatus,'ready');
  assert.equal(job.usage.requests,1);assert.equal(job.status,'succeeded');
  const refs=[...doc.draft.highlights,...doc.draft.risksAndBlockers].flatMap(x=>x.refs);
  for(const ref of refs)assert(JSON.stringify(doc.snapshot).includes(JSON.stringify(ref)),'absent evidence reference');
  observed.refs=refs;
  const response=await srv.req('/api/automation/weekly-reviews/'+f.weekKey+'/export');
  assert(response.ok);const md=await response.text();assert(md.includes(doc.draft.executiveSummary));
  await writeFile(path.join(f.run,mode+'-export.md'),md);
}finally{await writeFile(path.join(f.run,mode+'-result.json'),JSON.stringify(observed,null,2));await srv.stop();}
