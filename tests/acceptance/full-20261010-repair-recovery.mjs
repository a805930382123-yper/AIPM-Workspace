import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHarness,expect,request,rawInput,fileSnapshot} from './b08-harness.mjs';
import {fakeReply,bodyA,bodyB} from './b05-fake-reply.mjs';
const prefix='docs/reports/FULL-20261010-repair-recovery',started=Date.now(),checks=[];
const h=await createHarness(fakeReply);let s;
try{
 s=await h.start();const a=await expect(s,'/api/raw','POST',rawInput('恢复来源A',bodyA),201),b=await expect(s,'/api/raw','POST',rawInput('恢复来源B',bodyB),201);
 const workflow=await expect(s,'/api/knowledge/syntheses','POST',{rawIds:[a.id,b.id]},201);
 const beforeWiki=await fileSnapshot(path.join(h.dataRoot,'knowledge/wiki'));
 const marker=path.join(h.dataRoot,'.b08-fault.json');await fs.writeFile(marker,JSON.stringify({method:'rename',match:'/knowledge/wiki/'}));
 const failed=await request(s,`/api/knowledge/workflows/${workflow.id}/confirm`,'POST',{baseRevision:workflow.revision,idempotencyKey:randomUUID()});
 assert.equal(failed.status,500);assert.equal(failed.json?.error?.code,'WORKFLOW_COMMIT_PENDING');assert.ok(failed.json?.error?.details?.operationId);
 assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge/wiki')),beforeWiki);
 const rawFile=path.join(h.dataRoot,'knowledge/raw/reports',a.id+'.md'),original=await fs.readFile(rawFile),changed=Buffer.concat([original,Buffer.from('\n外部改动导致恢复来源失效。')]);
 await fs.writeFile(rawFile,changed);await fs.rm(marker);const calls=h.requests.length;await h.stop(s);s=await h.start();
 const result=await expect(s,`/api/knowledge/workflows/${workflow.id}`,'GET');assert.equal(result.status,'conflict');
 const manifest=JSON.parse(await fs.readFile(path.join(h.dataRoot,'state/knowledge-commits',failed.json.error.details.operationId+'.json'),'utf8'));
 assert.equal(manifest.status,'conflict');assert.equal(manifest.writtenIds.length,0);assert.match(manifest.error,/Raw/);
 assert.deepEqual(await fs.readFile(rawFile),changed);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge/wiki')),beforeWiki);assert.equal(h.requests.length,calls);
 await fs.writeFile(rawFile,original);const beforeRestart=await fileSnapshot(h.dataRoot);await h.stop(s);s=await h.start();assert.deepEqual(await fileSnapshot(h.dataRoot),beforeRestart);
 assert.equal((await expect(s,`/api/knowledge/workflows/${workflow.id}`,'GET')).status,'conflict');
 checks.push({id:'S02-knowledge-recovery-corrupt-source',result:'PASS',actualFilesystemFailure:true,pendingManifestPersisted:true,restartConflictRecorded:true,noFormalWikiWrites:true,noProviderOnRecovery:true,externalBytesPreserved:true,restoringRawDoesNotAutoCommitConflict:true});
}catch(e){checks.push({id:'S02-knowledge-recovery-corrupt-source',result:'FAIL',message:String(e).replaceAll(h.fakeKey,'[REDACTED]')});}finally{
 await h.close();const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};
 await fs.writeFile(prefix+'.json',JSON.stringify({provider:'isolated local HTTP fake; real quality BLOCKED',durationMs:Date.now()-started,checks,summary,servicesClosed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null),dataRoot:h.dataRoot},null,2));console.log(JSON.stringify(summary));if(summary.fail)process.exitCode=1;
}
