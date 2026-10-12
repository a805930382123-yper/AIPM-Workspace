import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileSnapshot } from './b07-harness.mjs';
const reportDir='docs/reports';
const runtime=JSON.parse(await fs.readFile(reportDir+'/B07-acceptance-browser-runtime.json','utf8'));
const aId='808b55e6-8bb1-4f7c-b6a6-ca687e17f289';
const get=async url=>{const r=await fetch(runtime.api+url);assert.equal(r.status,200);return r.json();};
if(process.argv[2]==='wiki-deleted-baseline'){
 const knowledge=await fileSnapshot(runtime.dataRoot+'/knowledge');
 const raw=await fileSnapshot(runtime.dataRoot+'/knowledge/raw');
 assert.deepEqual(raw,runtime.beforeRaw);
 assert.ok(!Object.keys(knowledge).includes('wiki\\'+runtime.wikiId+'.md'));
 assert.ok(Object.keys(knowledge).some(k=>k.startsWith('recycle\\wiki\\')&&k.includes(runtime.wikiId)));
 await fs.writeFile(reportDir+'/B07-browser-after-explicit-wiki-delete.json',JSON.stringify({knowledge,raw},null,2));
 console.log('Explicit isolated Wiki deletion recorded; Raw unchanged');
}else if(process.argv[2]==='wiki-deleted-final'){
 const baseline=JSON.parse(await fs.readFile(reportDir+'/B07-browser-after-explicit-wiki-delete.json','utf8'));
 const knowledge=await fileSnapshot(runtime.dataRoot+'/knowledge');assert.deepEqual(knowledge,baseline.knowledge);
 const result={knowledgeUnchangedSinceExplicitWikiDelete:true,detail:await get('/api/prompts/'+aId),stats:await get('/api/stats')};
 assert.equal(result.detail.wikiLinks[0].status,'missing');
 const exported=await fetch(runtime.api+'/api/prompts/'+aId+'/export');assert.equal(exported.status,200);const markdown=await exported.text();assert.ok(markdown.includes('status: missing'));assert.ok(markdown.endsWith(result.detail.prompt.body+'\n'));await fs.writeFile(reportDir+'/B07-browser-missing-link-export.md',markdown);
 const record=JSON.parse(await fs.readFile(runtime.dataRoot+'/prompts/'+aId+'.json','utf8'));assert.equal(record.current.version,7);assert.equal(record.versions.length,7);assert.ok(record.versions.every(v=>v.snapshot.body===record.current.body));
 result.exportExact=true;result.versionCount=record.versions.length;result.bodyUnchangedAcrossAllVersions=true;
 await fs.writeFile(reportDir+'/B07-browser-missing-link-final.json',JSON.stringify(result,null,2));console.log('Missing relation remains usable; subsequent Prompt operations leave knowledge unchanged');
}else if(process.argv[2]==='conflict'){
 const {prompt}=await get('/api/prompts/'+aId);
 const input=Object.fromEntries(['name','category','scenario','body','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'].map(k=>[k,prompt[k]]));
 input.scenario='另一个窗口已经保存的第六版';
 const response=await fetch(runtime.api+'/api/prompts/'+aId,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({baseVersion:prompt.version,...input})});
 assert.equal(response.status,200);const saved=await response.json();
 await fs.writeFile(reportDir+'/B07-browser-concurrent-update.json',JSON.stringify({before:prompt,after:saved},null,2));console.log('Independent concurrent update committed version '+saved.prompt.version);
}else{
 const record=JSON.parse(await fs.readFile(runtime.dataRoot+'/prompts/'+aId+'.json','utf8'));
 assert.equal(record.current.body,' 首行\n请为 {{客户名称}} 制定 {{业务流程}}；重复客户 {{ 客户名称 }}。\n尾部 ');
 assert.equal(record.versions[0].snapshot.scenario,'独立浏览器场景');
 assert.equal(record.versions[0].snapshot.favorite,true);
 const md=await fs.readFile(reportDir+'/B07-browser-export.md','utf8');
 assert.ok(md.includes('version: 3\n')); assert.ok(md.endsWith('## Prompt 正文\n\n'+record.current.body+'\n'));
 const raw=await fileSnapshot(runtime.dataRoot+'/knowledge/raw');
 const knowledge=await fileSnapshot(runtime.dataRoot+'/knowledge');
 assert.deepEqual(raw,runtime.beforeRaw); assert.deepEqual(knowledge,runtime.beforeKnowledge);
 const stats=await get('/api/stats'), list=await get('/api/prompts');
 const result={current:record.current,versionCount:record.versions.length,rawUnchanged:true,knowledgeUnchanged:true,exportExact:true,stats,list};
 await fs.writeFile(reportDir+'/B07-browser-file-checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify({currentVersion:record.current.version,promptCount:stats.promptCount,active:list.items.length,rawUnchanged:true,knowledgeUnchanged:true,exportExact:true}));
}
