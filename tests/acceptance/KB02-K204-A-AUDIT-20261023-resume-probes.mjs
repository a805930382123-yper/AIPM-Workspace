import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import http from 'node:http';
const repo=process.cwd(),prefix='docs/reports/KB02-K204-A-AUDIT-20261023-';
const hash=b=>createHash('sha256').update(b).digest('hex');
const execution=JSON.parse(await fs.readFile(prefix+'engineering-execution.json','utf8'));
const frozen=await fs.readFile('docs/reports/KB02-K204-A-20261023-freeze.json');
assert.equal(hash(frozen),execution.freezeSha);const freeze=JSON.parse(frozen);
for(const f of freeze.files){assert.equal(hash(await fs.readFile(f.path)),f.sha256);assert.equal(hash(await fs.readFile(path.join(execution.root,f.path))),f.sha256);}
process.chdir(execution.root);
const {startFake}=await import(pathToFileURL(path.resolve('tests/acceptance/KB02-K204-A-20261023-selftest.mjs')));
const {durable,sha}=await import(pathToFileURL(path.resolve('tests/acceptance/KB02-K204-A-20261023-core.mjs')));
const report={stage:'engineering-probes',startedAt:new Date().toISOString(),freezeSha256:hash(frozen),realCalls:0,rows:[],pass:false};
const owners=[];
try{
 const f=await startFake();owners.push(f);const e=f.lab.engine;
 const before=await fs.readFile(path.join(f.lab.root,'session.json'),'utf8');
 process.env.KB02_REAL='true';
 await assert.rejects(e.provider(),/NO_RELEASE/);await assert.rejects(e.begin('A1'),/NO_RELEASE/);
 for(const stage of ['B','C','all'])await assert.rejects(e.arm(stage,'none','none'),/STAGE_A_ONLY/);
 assert.equal(await fs.readFile(path.join(f.lab.root,'session.json'),'utf8'),before);assert.equal(f.configReads(),0);assert.equal(e.sent,0);assert.equal((await e.attempts()).length,0);
 delete process.env.KB02_REAL;
 const permit=await f.arm('A1');const armed=await fs.readFile(path.join(f.lab.root,'session.json'),'utf8');
 for(const patch of [{released:false},{sessionId:'other-session'},{stage:'A2'},{maxCalls:3}]){const file=path.join(f.lab.root,'probe-release.json');await durable(file,{...permit.release,...patch});await assert.rejects(e.arm('A1',file,sha(await fs.readFile(file))));}
 await assert.rejects(e.arm('A1',permit.file,'0'.repeat(64)),/RELEASE_SHA_DRIFT/);
 assert.equal(await fs.readFile(path.join(f.lab.root,'session.json'),'utf8'),armed);assert.equal(f.configReads(),0);assert.equal(e.sent,0);
 report.rows.push({id:'E01',pass:true,configReads:0,sent:0,stateUnchanged:true});
 let hits=0;const sink=http.createServer((_q,r)=>{hits++;r.end('unexpected');});await new Promise(r=>sink.listen(0,'127.0.0.1',r));
 try{const url=`http://127.0.0.1:${sink.address().port}`;await assert.rejects(fetch(url),/NETWORK_TARGET_DENIED/);assert.throws(()=>http.get(url),/NETWORK_TARGET_DENIED/);assert.equal(hits,0);}finally{await new Promise(r=>sink.close(r));}
 report.rows.push({id:'E06-direct-sink',pass:true,sinkHits:hits});
 // Independent fault injection: valid provider response cannot be recorded.
 await fs.mkdir(path.join(f.lab.root,'result-220.json'));
 const s=await e.load();const res=await fetch(f.lab.base+`/api/raw/${s.samples.A1.rawId}/extract`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(res.status,202);
 let state;for(let i=0;i<400;i++){state=await e.load();if(state.stopped)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(state.stopped,true);assert.equal(f.requests.length,1);assert.equal((await e.attempts()).length,1);assert.equal(state.stages.A1.status,'failed');
 await assert.rejects(e.arm('A1',permit.file,sha(await fs.readFile(permit.file))),/SESSION_STOPPED/);
 assert.equal(f.requests.length,1);assert((await fs.stat(path.join(f.lab.root,'response-220.private.bin'))).size>0);
 report.rows.push({id:'E04-result-persistence-failure',pass:true,fakeCalls:1,attempts:1,stopCode:state.stopCode,root:f.lab.root});
 report.pass=true;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{for(const owner of owners)await owner.close();process.chdir(repo);report.postMismatches=[];for(const f of freeze.files)if(hash(await fs.readFile(f.path))!==f.sha256)report.postMismatches.push(f.path);report.pass=report.pass&&!report.postMismatches.length;report.finishedAt=new Date().toISOString();await fs.writeFile(prefix+'resume-probes-'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
