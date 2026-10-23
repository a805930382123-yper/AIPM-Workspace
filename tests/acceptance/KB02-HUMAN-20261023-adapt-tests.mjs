import fs from 'node:fs/promises';
// Reviewed migration table: revision13 removes exactly the B1 runtime request. Failure,
// extraction, coverage, Raw, concurrency and historical revision12 lower bounds stay tested.
const changes={
'kb02-classification-priority.test.ts':[['outcome.callCount,3','outcome.callCount,2']],
'kb02-edge-extraction.test.ts':[['f.requests.length,3','f.requests.length,2'],['chunks(body).length+2','chunks(body).length+1']],
'kb02-extraction-contract.test.ts':[['result.outcome.callCount, 3','result.outcome.callCount, 2']],
'kb02-pipeline.test.ts':[['chunks.length + 2','chunks.length + 1'],['assert.equal(calls, 3)','assert.equal(calls, 2)'],['checkpoint.attempts, 5','checkpoint.attempts, 4']],
'kb02-planning-attribution.test.ts':[['requests.length,2','requests.length,1']],
'kb02-planning-context.test.ts':[['f.requests.length,2);assert.equal(f.cp.attempts,17)','f.requests.length,1);assert.equal(f.cp.attempts,16)'],['f.requests.length,3);assert.equal(f.cp.attempts,3)','f.requests.length,2);assert.equal(f.cp.attempts,2)'],['f.cp.attempts,attempts+2','f.cp.attempts,attempts+1'],['done.outcome.callCount,attempts+2','done.outcome.callCount,attempts+1'],['f.requests.length,3);assert.deepEqual(data(f.requests[1])','f.requests.length,2);assert.deepEqual(data(f.requests[1])']],
'kb02-r2.test.ts':[['done.outcome.callCount,4','done.outcome.callCount,3']],
'kb02-source-assignment.test.ts':[['f.requests.length,3','f.requests.length,2'],['f.cp.attempts,attempts+3','f.cp.attempts,attempts+2'],['assert.equal(f.requests.length,2);}','assert.equal(f.requests.length,1);}'],['await f.run(true);assert.equal(f.requests.length,2);assert.equal(Buffer','await f.run(true);assert.equal(f.requests.length,1);assert.equal(Buffer']],
'kb02-sr01-r1.test.ts':[['f.requests.length, calls + 3','f.requests.length, calls + 2'],['f.requests.length, calls + 2);\n    assert.equal((await f.checkpoint(job.id))?.attempts, 4)','f.requests.length, calls + 1);\n    assert.equal((await f.checkpoint(job.id))?.attempts, 3)']],
'kb02-storage-ui.test.tsx':[['f.requests.length, 4','f.requests.length, 3']],
'llm-flow.test.ts':[['started.finished.chunksTotal + 2, \'每块一次调用 + 一次规划 + 一次语义审核\'','started.finished.chunksTotal + 1, \'revision13每块一次调用 + 一次规划，人审不外发\'']],
'llm-http.test.ts':[['callCount, 6, \'四块 + 一次规划 + 一次语义审核\'','callCount, 5, \'revision13四块 + 一次规划，人审不外发\'']],
'llm-repair3.test.ts':[['finished.callCount, 6, \'四块各一次调用 + 一次规划 + 一次语义审核\'','finished.callCount, 5, \'revision13四块各一次调用 + 一次规划，人审不外发\'']],
};
const revisionFiles=['kb02-classification-priority.test.ts','kb02-edge-extraction.test.ts','kb02-extraction-contract.test.ts','kb02-final-classification.test.ts','kb02-planning-attribution.test.ts','kb02-planning-context.test.ts','kb02-planning-fields.test.ts','llm.test.ts'];
const report=[],updates=[];
for(const name of new Set([...Object.keys(changes),...revisionFiles])){
 const file='tests/'+name;let content=await fs.readFile(file,'utf8'),before=content;
 for(const [old,next] of changes[name]??[]){const count=content.split(old).length-1;if(!count)throw Error('missing exact migration '+name+': '+old);content=content.replaceAll(old,next);report.push({file,old,next,count,reason:'B1 runtime request removed; original business assertion retained'});}
 if(revisionFiles.includes(name)){const count=content.split('kb02-atoms-planning-12').length-1;content=content.replaceAll('kb02-atoms-planning-12','kb02-atoms-planning-13');report.push({file,count,reason:'Current revision expectation and deliberate older-version incompatibility construction; historical assets unchanged'});}
 if(content!==before)updates.push({file,content});
}
for(const {file,content} of updates)await fs.writeFile(file,content);
await fs.writeFile('docs/reports/KB02-HUMAN-20261023-test-migration.json',JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({changes:report.length}));
