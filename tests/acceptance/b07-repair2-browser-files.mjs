import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileSnapshot,request} from './b07-harness.mjs';
const prefix='docs/reports/B07-repair2-acceptance';
const rt=JSON.parse(await fs.readFile(prefix+'-browser-runtime.json','utf8')),ui=JSON.parse(await fs.readFile(prefix+'-browser.json','utf8')),s={base:rt.api};
const get=async url=>{const r=await request(s,url);assert.equal(r.status,200,r.text);return r.json;};
if(process.argv[2]==='concurrent'){
 const {prompt}=await get('/api/prompts/'+ui.aId);
 const input=Object.fromEntries(['name','category','scenario','body','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'].map(k=>[k,prompt[k]]));input.scenario='另一窗口已保存的第三版';
 const result=await request(s,'/api/prompts/'+ui.aId,'PUT',{baseVersion:prompt.version,...input});assert.equal(result.status,200);assert.equal(result.json.prompt.version,3);
 await fs.writeFile(prefix+'-concurrent.json',JSON.stringify({before:prompt,response:result},null,2));console.log('Another window committed A v3; browser editor still owns v2');
}else if(process.argv[2]==='checkpoint'){
 const prompts=await fileSnapshot(path.join(rt.dataRoot,'prompts')),knowledge=await fileSnapshot(path.join(rt.dataRoot,'knowledge'));assert.deepEqual(knowledge,rt.beforeKnowledge);
 await fs.writeFile(prefix+'-persistence-before.json',JSON.stringify({prompts,knowledge,restartCount:rt.restartCount??0},null,2));await fs.writeFile(path.join(rt.dataRoot,'.restart-api'),'1');console.log('Freeze prompt/knowledge bytes before same-directory restart');
}else{
 const before=JSON.parse(await fs.readFile(prefix+'-persistence-before.json','utf8'));assert.ok(rt.restartCount>before.restartCount);
 const prompts=await fileSnapshot(path.join(rt.dataRoot,'prompts')),knowledge=await fileSnapshot(path.join(rt.dataRoot,'knowledge'));assert.deepEqual(prompts,before.prompts);assert.deepEqual(knowledge,before.knowledge);assert.deepEqual(knowledge,rt.beforeKnowledge);
 const versions=[];for(const p of [...ui.created,...ui.moreCreated,{id:ui.retryId}]){const file=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',p.id+'.json'),'utf8'));assert.equal(file.current.version,1);assert.equal(file.versions.length,1);assert.equal(file.creation.requestId,p.requestId??p.id);versions.push({id:p.id,name:file.current.name,version:1});}
 const a=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',ui.aId+'.json'),'utf8'));assert.equal(a.current.version,3);assert.equal(a.versions.length,3);assert.ok(a.versions.every(v=>v.snapshot.body===a.current.body));assert.equal(a.versions[0].snapshot.scenario,'二返甲第一版场景');assert.equal(a.versions[1].snapshot.scenario,'二返甲第二版场景');assert.equal(a.current.favorite,true);
 const failed=await request(s,'/api/prompts/'+ui.failedId);assert.equal(failed.status,404);
 const list=await get('/api/prompts'),stats=await get('/api/stats');assert.equal(list.items.length,8);assert.equal(stats.promptCount,8);assert.equal(stats.rawCount,1);assert.equal(stats.wikiCount,1);
 const result={result:'PASS',dataRoot:rt.dataRoot,promptBytesUnchanged:true,knowledgeBytesUnchanged:true,rawBytesUnchanged:true,restartCount:rt.restartCount,aVersionCount:3,createdVersions:versions,failedStatus:failed.status,stats,prompts,knowledge};await fs.writeFile(prefix+'-browser-files.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,prompts:undefined,knowledge:undefined}));
}
