import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileSnapshot,request} from './b07-harness.mjs';
const prefix='docs/reports/B07-repair1-acceptance';
const rt=JSON.parse(await fs.readFile(prefix+'-browser-runtime.json','utf8'));
const ui=JSON.parse(await fs.readFile(prefix+'-browser.json','utf8'));
const prompts=await fileSnapshot(path.join(rt.dataRoot,'prompts'));
if(process.argv[2]==='checkpoint'){
 await fs.writeFile(prefix+'-browser-persistence-before.json',JSON.stringify({prompts,restartCount:rt.restartCount??0},null,2));
 await fs.writeFile(path.join(rt.dataRoot,'.restart-api'),'1');
 console.log('Prompt bytes frozen before another same-directory restart');
}else{
 const before=JSON.parse(await fs.readFile(prefix+'-browser-persistence-before.json','utf8'));
 assert.ok(rt.restartCount>before.restartCount);assert.deepEqual(prompts,before.prompts);
 const knowledge=await fileSnapshot(path.join(rt.dataRoot,'knowledge'));
 assert.deepEqual(knowledge,rt.beforeKnowledge);
 const s={base:rt.api};const list=await request(s,'/api/prompts');assert.equal(list.status,200);assert.equal(list.json.items.length,4);
 const a=await request(s,'/api/prompts/'+ui.aId),b=await request(s,'/api/prompts/'+rt.bId);
 assert.equal(a.status,200);assert.equal(b.status,200);
 const aFile=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',ui.aId+'.json'),'utf8'));
 const bFile=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',rt.bId+'.json'),'utf8'));
 assert.equal(aFile.current.version,3);assert.equal(aFile.versions.length,3);
 assert.equal(bFile.current.version,3);assert.equal(bFile.versions.length,3);
 for(const v of aFile.versions)assert.equal(v.snapshot.body,aFile.current.body);
 assert.equal(aFile.current.favorite,true);assert.equal(bFile.current.favorite,true);
 const removed=await request(s,'/api/prompts/'+ui.cId);assert.equal(removed.status,404);
 const stats=await request(s,'/api/stats');assert.equal(stats.status,200);
 const result={result:'PASS',dataRoot:rt.dataRoot,restartCount:rt.restartCount,promptBytesUnchanged:true,knowledgeBytesUnchanged:true,rawBytesUnchanged:true,activePromptCount:list.json.items.length,aVersions:aFile.versions.length,bVersions:bFile.versions.length,removedStatus:removed.status,stats:stats.json,prompts,knowledge};
 await fs.writeFile(prefix+'-browser-files.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,prompts:undefined,knowledge:undefined}));
}
