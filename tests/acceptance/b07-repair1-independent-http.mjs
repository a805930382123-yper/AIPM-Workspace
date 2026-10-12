import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import yaml from 'js-yaml';
import {createHarness,expect,request,fileSnapshot,rawInput,wikiInput,filesUnder} from './b07-harness.mjs';
const h=await createHarness(()=>{throw Error('B07 must not call a provider');});let s=await h.start(h.dataRoot,false);
const report={clientDate:'2026-10-07',dataRoot:h.dataRoot,provider:'unconfigured; no model calls',checks:[]};const started=Date.now();
const input=(name,body='正文 {{客户名称}}',extra={})=>({name,body,category:'customer',scenario:'客户拜访',inputRequirements:'输入客户资料',outputRequirements:'输出问题清单',relatedWikiIds:[],examples:'\n 示例 \n',tags:['访谈'],favorite:false,...extra});
const fields=p=>Object.fromEntries(['name','body','category','scenario','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'].map(k=>[k,p[k]]));
const create=async data=>(await expect(s,'/api/prompts','POST',{requestId:randomUUID(),...data},201)).prompt;
const update=async(p,data)=>(await expect(s,'/api/prompts/'+p.id,'PUT',{baseVersion:p.version,...fields(p),...data})).prompt;
const get=async id=>(await expect(s,'/api/prompts/'+id,'GET')).prompt;
const snap=()=>fileSnapshot(path.join(h.dataRoot,'prompts'));
async function restart(){const port=s.port;await h.stop(s);s=await h.start(h.dataRoot,false,port);}
async function test(id,fn){try{const evidence=await fn();report.checks.push({id,result:'PASS',evidence});console.log('PASS '+id);}catch(e){report.checks.push({id,result:'FAIL',error:e.message});console.log('FAIL '+id+': '+e.message);}}
try{
 await test('E07-01-full-fields-long-text-and-validation',async()=>{
  assert.equal((await expect(s,'/api/llm/config','GET')).configured,false);
  const schema=await expect(s,'/api/prompts/schema','GET');assert.deepEqual(schema.categories.map(x=>[x.id,x.label]),[['industry_learning','行业学习'],['business_analysis','业务分析'],['customer','客户'],['product','产品'],['ai','AI'],['office','日常办公']]);
  const body=' \r\n'+('中文🙂 $& \\ ` --- {{客户名称}}\n').repeat(700)+'\n 尾部 \t';const p=await create(input('完整字段',body));assert.equal((await get(p.id)).body,body);assert.equal(p.source,'manual');assert.deepEqual(p.variables,['客户名称']);
  const disk=JSON.parse(await fs.readFile(path.join(h.dataRoot,'prompts',p.id+'.json'),'utf8'));assert.deepEqual(disk.current,p);assert.deepEqual(disk.versions[0].snapshot,p);
  const before=await snap();for(const patch of [{name:' '},{body:'\n '},{category:'bogus'},{tags:'访谈'},{favorite:'true'},{relatedWikiIds:['../../unsafe']},{version:99},{source:'optimized'},{variables:['伪造']},{unknown:true},{body:'字'.repeat(100001)}])await expect(s,'/api/prompts','POST',{requestId:randomUUID(),...input('拒绝'),...patch},400);
  await expect(s,'/api/prompts/%2E%2E%2Foutside','GET',undefined,400);assert.deepEqual(await snap(),before);return{promptId:p.id,characters:body.length,strictRejections:12};
 });
 await test('E07-02-search-filters-and-global-counts',async()=>{
  const a=await create(input('门店动销方案','陈列货架方案',{category:'business_analysis',tags:['趋势','渠道'],favorite:true}));const b=await create(input('客户计划','内容差异',{category:'customer',tags:['渠道'],favorite:false}));
  for(const term of ['动销','趋势','货架'])assert.ok((await expect(s,'/api/prompts?q='+encodeURIComponent(term),'GET')).items.some(x=>x.id===a.id));
  const all=await expect(s,'/api/prompts','GET'),f=await expect(s,'/api/prompts?category=business_analysis&tag='+encodeURIComponent('渠道')+'&favorite=true','GET');assert.deepEqual(f.items.map(x=>x.id),[a.id]);assert.deepEqual(f.categoryCounts,all.categoryCounts);assert.ok((await expect(s,'/api/prompts?favorite=false','GET')).items.every(x=>!x.favorite));assert.equal((await expect(s,'/api/prompts?q=独立不存在字段','GET')).items.length,0);assert.ok(all.items.some(x=>x.id===b.id));return{total:all.items.length,combinedId:a.id};
 });
 await test('E07-03-immutable-history-no-op-and-restart',async()=>{
  let p=await create(input('版本记录','第1版正文'));const v1=(await expect(s,`/api/prompts/${p.id}/versions/1`,'GET')).version;
  p=await update(p,{body:'第2版 {{产品名称}}',tags:['新品'],favorite:true});p=await update(p,{name:'人工第三版',examples:'第三版示例'});const old=(await expect(s,`/api/prompts/${p.id}/versions/1`,'GET')).version;assert.deepEqual(old,v1);
  const before=await snap(),noOp=await update(p,{});assert.deepEqual(noOp,p);assert.deepEqual(await snap(),before);await restart();assert.deepEqual(await get(p.id),p);const versions=(await expect(s,`/api/prompts/${p.id}/versions`,'GET')).items;assert.equal(versions.length,3);assert.ok(versions.every(x=>x.changeSource==='manual'&&x.snapshot.version===x.version));return{promptId:p.id,version:3,v1};
 });
 await test('E07-04-concurrency-and-stable-create-retry',async()=>{
  const requestId=randomUUID(),initial=input('可重试','初始正文'),made=await expect(s,'/api/prompts','POST',{requestId,...initial},201);const p=made.prompt;
  const replies=await Promise.all(['并发甲','并发乙'].map(body=>request(s,'/api/prompts/'+p.id,'PUT',{baseVersion:1,...initial,body})));assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);const current=await get(p.id),before=await snap();
  for(const method of ['PUT','DELETE'])await expect(s,'/api/prompts/'+p.id,method,{...method==='PUT'?initial:{},baseVersion:1},409);
  const retry=await expect(s,'/api/prompts','POST',{requestId,...initial});assert.equal(retry.reused,true);assert.deepEqual(retry.prompt,current);await expect(s,'/api/prompts','POST',{requestId,...initial,name:'改初始载荷'},409);assert.deepEqual(await snap(),before);return{statuses:replies.map(r=>r.status),version:current.version,reused:true};
 });
 await test('E07-05-literal-values-and-read-only-render',async()=>{
  const p=await create(input('一次替换',' \n{{客户名称}} | {{ 客户名称 }} | {{指标}} | {{}} | {{bad\nname}} | {{ {{inner}} }}\n尾'));const values={客户名称:'$& $1 \\ \n {{指标}}',指标:'0'},before=await fileSnapshot(h.dataRoot);
  const rendered=await expect(s,`/api/prompts/${p.id}/render`,'POST',{baseVersion:1,values});assert.equal(rendered.body,' \n'+values.客户名称+' | '+values.客户名称+' | 0 | {{}} | {{bad\nname}} | {{ {{inner}} }}\n尾');
  for(const map of [{客户名称:'甲'},{客户名称:' ',指标:'0'}])await expect(s,`/api/prompts/${p.id}/render`,'POST',{baseVersion:1,values:map},422);
  for(const map of [{客户名称:1},{客户名称:'甲',指标:'0',未知:'乙'}])await expect(s,`/api/prompts/${p.id}/render`,'POST',{baseVersion:1,values:map},400);
  await expect(s,`/api/prompts/${p.id}/render`,'POST',{baseVersion:2,values},409);assert.deepEqual(await fileSnapshot(h.dataRoot),before);
  const proto=await create(input('原型键','{{__proto__}}|{{constructor}}'));assert.equal((await expect(s,`/api/prompts/${proto.id}/render`,'POST',{baseVersion:1,values:JSON.parse('{"__proto__":"甲","constructor":"乙"}')})).body,'甲|乙');return{promptId:p.id,rendered:rendered.body,wholeRootUnchanged:true};
 });
 await test('E07-07-delete-recycle-and-real-counts',async()=>{
  const p=await create(input('待删除','无变量')),beforeKnowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge')),beforeCount=(await expect(s,'/api/stats','GET')).promptCount;
  await fs.writeFile(path.join(h.dataRoot,'prompts','misc.json'),'{}');await fs.writeFile(path.join(h.dataRoot,'prompts','.temporary.tmp'),'tmp');await fs.mkdir(path.join(h.dataRoot,'prompts','versions'),{recursive:true});await fs.writeFile(path.join(h.dataRoot,'prompts','versions',randomUUID()+'.json'),JSON.stringify({id:randomUUID()}));
  assert.equal((await expect(s,'/api/stats','GET')).promptCount,beforeCount);await expect(s,'/api/prompts/'+p.id,'DELETE',{baseVersion:1});
  for(const suffix of ['','/versions','/versions/1','/export'])await expect(s,'/api/prompts/'+p.id+suffix,'GET',undefined,404);assert.equal((await expect(s,'/api/stats','GET')).promptCount,beforeCount-1);await expect(s,'/api/prompts','POST',{requestId:p.id,...fields(p)},409);await restart();assert.ok(!(await expect(s,'/api/prompts','GET')).items.some(x=>x.id===p.id));assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),beforeKnowledge);return{removedId:p.id,countBefore:beforeCount,countAfter:beforeCount-1};
 });
 await test('E07-08-dangling-wiki-still-usable',async()=>{
  const raw=await expect(s,'/api/raw','POST',rawInput('关联来源','独立验收原文'),201);const wiki=await expect(s,'/api/wiki','POST',wikiInput('B07关联指标',[raw.id],'知识内容'),201);let p=await create(input('关联模板','{{客户名称}}',{relatedWikiIds:[wiki.id]}));assert.equal((await expect(s,'/api/prompts/'+p.id,'GET')).wikiLinks[0].status,'resolved');
  await expect(s,'/api/wiki/'+wiki.id,'DELETE',{baseRevision:wiki.revision});const afterDelete=await fileSnapshot(path.join(h.dataRoot,'knowledge'));assert.equal((await expect(s,'/api/prompts/'+p.id,'GET')).wikiLinks[0].status,'missing');p=await update(p,{scenario:'删Wiki后仍可编辑'});assert.equal((await expect(s,`/api/prompts/${p.id}/render`,'POST',{baseVersion:p.version,values:{客户名称:'仍可用'}})).body,'仍可用');
  const exported=await request(s,'/api/prompts/'+p.id+'/export');assert.ok(exported.text.includes('关联已失效'));await expect(s,'/api/prompts','POST',{requestId:randomUUID(),...input('无效新关联','正文',{relatedWikiIds:[randomUUID()]})},400);assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),afterDelete);return{promptId:p.id,wikiId:wiki.id,link:'missing',knowledgeUnchangedAfterExplicitDeletion:true};
 });
 await test('E07-09-independent-markdown-read',async()=>{
  const body=' \n## 用户标题\n```json\n{"a":"{{客户名称}}"}\n```\n---\n尾部 \n',p=await create(input('导出 : "标题"',body));const before=await fileSnapshot(h.dataRoot);const r=await fetch(s.base+'/api/prompts/'+p.id+'/export'),text=await r.text();assert.equal(r.status,200);assert.ok(r.headers.get('content-type').includes('text/markdown'));assert.ok(r.headers.get('content-disposition').includes('prompt-'+p.id+'.md'));
  const end=text.indexOf('\n---',4),meta=yaml.load(text.slice(4,end));assert.equal(meta.name,p.name);assert.deepEqual(meta.variables,['客户名称']);assert.equal(meta.source,'manual');assert.equal(meta.version,1);const marker='\n## Prompt 正文\n\n';assert.equal(text.slice(text.indexOf(marker)+marker.length),body+'\n');for(const term of ['输入要求','输出要求','示例'])assert.ok(text.includes(term));await fs.writeFile('docs/reports/B07-repair1-acceptance-export.md',text);assert.deepEqual(await fileSnapshot(h.dataRoot),before);return{promptId:p.id,metadata:meta,verbatimBody:true};
 });
 await test('E07-10-real-storage-failures-and-recovery',async()=>{
  let p=await create(input('存储故障','原始正文')),before=await snap(),fault=path.join(h.dataRoot,'.b07-fault.json');
  for(const f of [{method:'writeFile',match:'.tmp'},{method:'rename',match:'/prompts/'+p.id+'.json'}]){await fs.writeFile(fault,JSON.stringify(f));try{const r=await expect(s,'/api/prompts/'+p.id,'PUT',{baseVersion:1,...fields(p),body:'不能保存'},500);assert.equal(r.error.code,'PROMPT_WRITE_FAILED');assert.deepEqual(await snap(),before);}finally{await fs.rm(fault,{force:true});}}
  await fs.writeFile(fault,JSON.stringify({method:'rename',match:'/prompts/recycle/'}));try{assert.equal((await expect(s,'/api/prompts/'+p.id,'DELETE',{baseVersion:1},500)).error.code,'PROMPT_DELETE_FAILED');assert.deepEqual(await snap(),before);}finally{await fs.rm(fault,{force:true});}
  p=await update(p,{body:'解除故障后保存'});await restart();assert.equal((await get(p.id)).version,2);assert.equal((await filesUnder(path.join(h.dataRoot,'prompts'))).filter(f=>f.endsWith('.tmp')&& !f.endsWith('temporary.tmp')).length,0);return{promptId:p.id,failures:3,finalVersion:2};
 });
 await test('E07-12-no-LLM-and-knowledge-stat-isolation',async()=>{
  const before=await expect(s,'/api/stats','GET'),knowledge=await fileSnapshot(path.join(h.dataRoot,'knowledge'));let p=await create(input('统计独立','模板正文'));p=await update(p,{favorite:true});const during=await expect(s,'/api/stats','GET');assert.equal(during.promptCount,before.promptCount+1);for(const k of ['rawCount','wikiCount','openAuditCount','thisWeekNewCount','pendingConfirmationCount','recentChanges'])assert.deepEqual(during[k],before[k]);await expect(s,'/api/prompts/'+p.id,'DELETE',{baseVersion:p.version});assert.deepEqual(await fileSnapshot(path.join(h.dataRoot,'knowledge')),knowledge);for(const route of ['/api/raw','/api/wiki','/api/audits','/api/wiki-lint'])await expect(s,route,'GET');assert.equal((await expect(s,'/api/llm/config','GET')).configured,false);assert.equal(h.requests.length,0);return{promptBefore:before.promptCount,promptDuring:during.promptCount,noProviderRequests:true};
 });
 await test('E07-extra-damaged-record-valid-counting',async()=>{
  const id=randomUUID(),target=path.join(h.dataRoot,'prompts',id+'.json'),before=(await expect(s,'/api/stats','GET')).promptCount;await fs.writeFile(target,JSON.stringify({id,current:{id},versions:[],creation:{}}));
  try{const direct=await request(s,'/api/prompts/'+id);report.damagedActual={direct,count:(await expect(s,'/api/stats','GET')).promptCount};assert.ok(direct.status>=400,'incomplete stored current must not look like a successful Prompt');assert.equal(report.damagedActual.count,before);}finally{await fs.rm(target);}
 });
}finally{await h.close();report.services=h.services.map(x=>({pid:x.child.pid,closed:x.child.exitCode!==null||x.child.signalCode!==null,logs:x.logs}));report.durationMs=Date.now()-started;report.summary={pass:report.checks.filter(x=>x.result==='PASS').length,fail:report.checks.filter(x=>x.result==='FAIL').length};await fs.writeFile('docs/reports/B07-repair1-acceptance-http.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.summary));if(report.summary.fail)process.exitCode=1;
