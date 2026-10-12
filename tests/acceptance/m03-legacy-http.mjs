import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createHarness,expect,request,fileSnapshot,rawInput,wikiInput} from './b09-harness.mjs';
import {input,reply} from './b08-fixtures.mjs';
const prefix='docs/reports/M03-legacy-http'+(process.argv[2]?'-'+process.argv[2]:'');
const h=await createHarness(reply),checks=[];let s,demo,ids,raw,wiki,prompt;
const run=async(id,fn)=>{try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',message:String(e),stack:e.stack});}await fs.writeFile(prefix+'.json',JSON.stringify({provider:'independent fake; real quality NOT_RUN',dataRoot:h.dataRoot,checks},null,2));};
const counts=()=>expect(s,'/api/stats');
const promptEdit=p=>Object.fromEntries(['name','category','scenario','body','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'].map(k=>[k,p[k]]));
const wikiEdit=p=>Object.fromEntries(['title','type','category','body','sources','tags','aliases','knowledge_status','confidence','source_level','review_status'].map(k=>[k,p[k]]));
try{
 s=await h.start(h.dataRoot,false);
 await run('E09-01-empty-no-autoseed',async()=>{const c=await counts();for(const k of ['rawCount','wikiCount','thisWeekNewCount','pendingConfirmationCount','openAuditCount','promptCount'])assert.equal(c[k],0,k);assert.equal((await expect(s,'/api/demo')).imported,false);await h.stop(s);s=await h.start(h.dataRoot,false);assert.equal((await counts()).rawCount,0);return c;});
 await run('E09-02-confirm-required-and-concurrent-import',async()=>{
  const before=await fileSnapshot(h.dataRoot);assert.equal((await request(s,'/api/demo/import','POST',{})).status,400);assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  const rs=await Promise.all(Array.from({length:4},()=>request(s,'/api/demo/import','POST',{confirm:true})));assert.ok(rs.every(r=>r.status===200&&r.json.complete));
  demo=await expect(s,'/api/demo');ids=demo.items.map(i=>i.id);assert.equal(new Set(ids).size,10);assert.equal(demo.items.filter(i=>i.type==='raw').length,1);assert.equal(demo.items.filter(i=>i.type==='wiki').length,5);assert.equal(demo.items.filter(i=>i.type==='prompt').length,4);
  assert.equal(demo.exampleTask.task,'第一次访谈经销商负责人，了解订货流程和AI机会');
  const c=await counts();assert.equal(c.rawCount,1);assert.equal(c.wikiCount,5);assert.equal(c.promptCount,4);assert.equal(c.thisWeekNewCount,6);return {statuses:rs.map(r=>r.status),created:rs.map(r=>r.json.created.length),ids,counts:c};
 });
 await run('E09-02-persistent-demo-labels-and-edit-retention',async()=>{
  for(const i of demo.items){const v=await expect(s,`/api/${i.type==='prompt'?'prompts':i.type}/${i.id}`);const p=i.type==='prompt'?v.prompt:v;assert.equal(p.isDemo,true);assert.ok(p.body.includes('演示数据'));if(i.type==='wiki'){assert.equal(p.knowledge_status,'needs_verification');assert.equal(p.source_level,'D');}}
  raw=await expect(s,`/api/raw/${demo.items.find(i=>i.type==='raw').id}`);wiki=await expect(s,`/api/wiki/${demo.items.find(i=>i.type==='wiki').id}`);prompt=(await expect(s,`/api/prompts/${demo.items.find(i=>i.type==='prompt').id}`)).prompt;
  wiki=await expect(s,`/api/wiki/${wiki.id}`,'PUT',{...wikiEdit(wiki),body:'用户编辑保留 B09_EDIT_WIKI',baseRevision:wiki.revision});
  prompt=(await expect(s,`/api/prompts/${prompt.id}`,'PUT',{...promptEdit(prompt),body:'用户编辑保留 {{姓名}} B09_EDIT_PROMPT',baseVersion:prompt.version})).prompt;
  assert.equal(wiki.isDemo,true);assert.equal(prompt.isDemo,true);const before=await fileSnapshot(path.join(h.dataRoot,'knowledge'));const ps=await fileSnapshot(path.join(h.dataRoot,'prompts'));
  await expect(s,'/api/demo/import','POST',{confirm:true});assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),before);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'prompts')),ps);
  await h.stop(s);s=await h.start(h.dataRoot,false);const storedWiki=await expect(s,`/api/wiki/${wiki.id}`);assert.ok(storedWiki.body.endsWith(wiki.body));assert.ok(storedWiki.body.includes('演示数据'));assert.equal(storedWiki.isDemo,true);assert.equal((await expect(s,`/api/prompts/${prompt.id}`)).prompt.body,prompt.body);assert.deepEqual((await expect(s,'/api/demo')).items.map(i=>i.id),ids);return {editedWiki:wiki.id,editedPrompt:prompt.id,rawSha:raw.bodySha256,storedBodyHasRequiredDemoHeader:true};
 });
 await run('E09-02-delete-never-resurrect',async()=>{await expect(s,`/api/wiki/${wiki.id}`,'DELETE',{baseRevision:wiki.revision});await expect(s,`/api/prompts/${prompt.id}`,'DELETE',{baseVersion:prompt.version});await expect(s,'/api/demo/import','POST',{confirm:true});await h.stop(s);s=await h.start(h.dataRoot,false);await expect(s,'/api/demo/import','POST',{confirm:true});assert.equal((await request(s,`/api/wiki/${wiki.id}`)).status,404);assert.equal((await request(s,`/api/prompts/${prompt.id}`)).status,404);const d=await expect(s,'/api/demo');for(const id of [wiki.id,prompt.id])assert.equal(d.items.find(i=>i.id===id).status,'deleted');return {counts:await counts(),deleted:[wiki.id,prompt.id]};});
 await run('E09-06-no-key-manual-and-ai-explicit-errors',async()=>{
  const r=await expect(s,'/api/raw','POST',rawInput('B09手动独立','原文独特 MANUAL_B09 不允许改写'),201);const w=await expect(s,'/api/wiki','POST',wikiInput('B09手动业务页面',[r.id],'人工整理 MANUAL_B09'),201);assert.ok((await expect(s,'/api/wiki?q=MANUAL_B09')).items.some(p=>p.id===w.id));assert.ok((await expect(s,`/api/raw/${r.id}/references`)).items.some(p=>p.id===w.id));
  const kb=await fileSnapshot(path.join(h.dataRoot,'knowledge'));const p=await expect(s,'/api/prompts','POST',{requestId:crypto.randomUUID(),...input('B09手动Prompt','输入 {{客户名称}}')},201);assert.deepEqual(p.prompt.variables,['客户名称']);await expect(s,`/api/prompts/${p.prompt.id}`,'PUT',{...promptEdit(p.prompt),body:'第二版 {{业务流程}}',baseVersion:1});assert.equal((await expect(s,`/api/prompts/${p.prompt.id}/versions`)).items.length,2);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),kb);
  const errors=[];for(const [url,body] of [['/api/prompt-ai/brief',{task:'分析业务',template:'custom'}],['/api/prompt-ai/optimize',{body:'分析业务'}]]){const v=await request(s,url,'POST',body);assert.ok(v.status>=400);assert.equal(v.json.error.code,'LLM_NOT_CONFIGURED');errors.push(v.json.error.code);}
  assert.equal((await expect(s,`/api/raw/${r.id}`)).body,r.body);return {rawId:r.id,wikiId:w.id,promptId:p.prompt.id,errors};
 });
 await run('E09-03-real-write-failure-and-manifest-retry',async()=>{
  const root=await fs.mkdtemp(path.join(path.dirname(h.dataRoot),'fmcg-b09-demo-fault-'));const fault=await h.start(root,false);await fs.writeFile(path.join(root,'.b08-fault.json'),JSON.stringify({method:'rename',match:'/knowledge/wiki/'}));const first=await request(fault,'/api/demo/import','POST',{confirm:true});assert.ok(first.status>=400||first.json.complete===false);const manifest=JSON.parse(await fs.readFile(path.join(root,'state/demo-manifest.json'),'utf8'));const planned=manifest.items.map(i=>i.id);const observed=JSON.parse(await fs.readFile(path.join(root,'.b08-fault-observed.json'),'utf8'));await fs.rm(path.join(root,'.b08-fault.json'));const second=await expect(fault,'/api/demo/import','POST',{confirm:true});assert.equal(second.complete,true);assert.deepEqual((await expect(fault,'/api/demo')).items.map(i=>i.id),planned);const c=await expect(fault,'/api/stats');assert.equal(c.rawCount,1);assert.equal(c.wikiCount,5);assert.equal(c.promptCount,4);return {root,first:first.json,observed,retry:second,counts:c};
 });
 await run('E09-03-manifest-failure-after-raw-commit',async()=>{
  const root=await fs.mkdtemp(path.join(path.dirname(h.dataRoot),'fmcg-b09-manifest-fault-')),fault=await h.start(root,false);await fs.writeFile(path.join(root,'.b09-demo-fault.json'),JSON.stringify({nth:2}));const first=await request(fault,'/api/demo/import','POST',{confirm:true});assert.ok(first.status>=400||first.json.complete===false);const observed=JSON.parse(await fs.readFile(path.join(root,'.b09-demo-fault-observed.json'),'utf8'));const d=await expect(fault,'/api/demo');const rid=d.items.find(i=>i.type==='raw').id;const rawBefore=await expect(fault,`/api/raw/${rid}`);await fs.rm(path.join(root,'.b09-demo-fault.json'));const second=await expect(fault,'/api/demo/import','POST',{confirm:true});assert.equal(second.complete,true);assert.equal((await expect(fault,`/api/raw/${rid}`)).bodySha256,rawBefore.bodySha256);const c=await expect(fault,'/api/stats');assert.equal(c.rawCount,1);assert.equal(c.wikiCount,5);assert.equal(c.promptCount,4);return {root,first:first.json,observed,retry:second,rawId:rid,rawSha:rawBefore.bodySha256};
 });
}finally{await h.close();}
if(checks.some(c=>c.result==='FAIL'))process.exitCode=1;

