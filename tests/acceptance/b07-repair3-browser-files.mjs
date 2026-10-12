import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileSnapshot,request} from './b07-harness.mjs';
const prefix='docs/reports/B07-repair3-acceptance';
const rt=JSON.parse(await fs.readFile(prefix+'-browser-runtime.json','utf8'));
const ui=JSON.parse(await fs.readFile(prefix+'-browser.json','utf8'));
const get=async url=>{const r=await request({base:rt.api},url);assert.equal(r.status,200,r.text);return r.json;};
const prompts=await fileSnapshot(path.join(rt.dataRoot,'prompts'));
const knowledge=await fileSnapshot(path.join(rt.dataRoot,'knowledge'));
assert.deepEqual(knowledge,rt.beforeKnowledge);
if(process.argv[2]==='checkpoint'){
 await fs.writeFile(prefix+'-persistence-before.json',JSON.stringify({prompts,knowledge,restartCount:rt.restartCount??0},null,2));
 await fs.writeFile(path.join(rt.dataRoot,'.restart-api'),'1');
 console.log('Saved byte checkpoint; requested same-directory API restart');
}else{
 const before=JSON.parse(await fs.readFile(prefix+'-persistence-before.json','utf8'));
 assert.ok(rt.restartCount>before.restartCount);
 assert.deepEqual(prompts,before.prompts);assert.deepEqual(knowledge,before.knowledge);
 const versions=[];
 for(const p of ui.created){
  const f=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',p.id+'.json'),'utf8'));
  assert.equal(f.current.version,1);assert.equal(f.versions.length,1);
  assert.equal(f.creation.requestId,p.requestId);assert.equal(f.current.name,p.name);
  versions.push({id:p.id,name:p.name,requestId:p.requestId,version:1});
 }
 const a=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',ui.aId+'.json'),'utf8'));
 assert.equal(a.current.version,2);assert.equal(a.versions.length,2);
 const body=' 首行\n请为 {{客户名称}} 制定 {{业务流程}}；重复客户 {{ 客户名称 }}。\n尾部 ';
 assert.equal(a.current.body,body);assert.ok(a.versions.every(v=>v.snapshot.body===body));
 assert.equal(a.versions[0].snapshot.scenario,'三返甲第一版场景');
 assert.equal(a.versions[1].snapshot.scenario,'三返甲第二版场景');
 assert.equal(a.current.favorite,true);assert.deepEqual(a.current.tags,['甲标签','三返']);
 assert.deepEqual(a.current.relatedWikiIds,[rt.wikiId]);
 const b=JSON.parse(await fs.readFile(path.join(rt.dataRoot,'prompts',rt.bId+'.json'),'utf8'));
 assert.equal(b.current.version,2);assert.equal(b.versions.length,2);
 assert.equal(b.versions[0].snapshot.body,'模板乙无变量原文。');
 assert.equal(b.current.body,'模板乙第二版无变量原文。');
 const list=await get('/api/prompts'),stats=await get('/api/stats');
 assert.equal(list.items.length,5);assert.equal(stats.promptCount,5);
 assert.equal(stats.rawCount,1);assert.equal(stats.wikiCount,1);
 assert.ok(ui.checks.every(c=>c.result==='PASS'));
 const result={result:'PASS',dataRoot:rt.dataRoot,restartCount:rt.restartCount,promptBytesUnchanged:true,knowledgeBytesUnchanged:true,rawBytesUnchanged:true,aVersionCount:2,bVersionCount:2,createdVersions:versions,stats,prompts,knowledge};
 await fs.writeFile(prefix+'-browser-files.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,prompts:undefined,knowledge:undefined}));
}
