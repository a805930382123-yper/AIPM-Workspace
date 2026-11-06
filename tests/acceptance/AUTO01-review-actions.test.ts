import test from 'node:test';
import assert from 'node:assert/strict';
import {lwFixture} from '../lw01-fixture.ts';
import {randomUUID} from 'node:crypto';

test('AUTO01 pending exact draft binding rejects missing or unrelated records without new extraction',async()=>{
 const f=await lwFixture();
 const raw=await f.rawStore.create({title:'绑定校验',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖10家。'});
 const d=await f.generate(raw.id),count=f.requests.length;
 const get=f.drafts.get.bind(f.drafts);
 for(const invalid of [undefined,{...d,rawId:randomUUID()},{...d,jobId:randomUUID()},{...d,status:'confirmed' as const}]){
  f.drafts.get=async id=>id===d.id?invalid:get(id);
  await assert.rejects(f.runner.start(raw.id,{newJobId:randomUUID(),now:new Date().toISOString()}),{code:'STORAGE_RECONCILE_CONFLICT'});
  assert.equal(f.requests.length,count);
 }
 f.drafts.get=get;
 const same=await f.runner.start(raw.id,{newJobId:randomUUID(),now:new Date().toISOString()});
 assert.equal(same.job.id,d.jobId);assert.equal(f.requests.length,count);
});

test('AUTO01 redirects merge stable outcomes; update to create removes old target material; finish preserves history',async()=>{
 const f=await lwFixture();
 const source=await f.rawStore.create({title:'旧材料',sourceType:'report',sourceName:'合成',tags:[],body:'旧渠道值为8。'});
 const target=await f.wiki.create({title:'渠道汇总',type:'metric',category:'channel',body:'人工目标专属内容。',sources:[source.id],tags:[],aliases:[],knowledge_status:'source_supported',confidence:'high',source_level:'D',review_status:'reviewed'});
 const raw=await f.rawStore.create({title:'本轮',sourceType:'report',sourceName:'合成',tags:[],body:'甲渠道为20。\n\n乙渠道为30。'});
 f.setTopics(['甲渠道','乙渠道']);
 let d=await f.generate(raw.id);
 const complete=f.provider.complete.bind(f.provider);
 f.provider.complete=async request=>{
  const value=JSON.parse(request.user);
  if(!value.requested)return complete(request);
  const old=value.context[0];
  const change={pageIndexes:value.pages.map((_:unknown,i:number)=>i),action:value.requested.action,targetWikiId:old?.id??null,baseRevision:old?.revision??null,title:old?.title??'独立新建',body:[old?.body,...value.pages.flatMap((p:any)=>p.source_facts.map((fact:any)=>fact.text))].filter(Boolean).join('\n'),aliases:[],tags:[],reason:'独验指定动作',summary:['真实快照准备'],questions:[],dependsOn:[]};
  const text=JSON.stringify({version:1,changes:[change]});return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};
 };
 const prepare=async(changeId:string,action:'update'|'create'|'link'|'noop',targetWikiId?:string)=>f.runner.prepareChange(d.id,{baseRevision:d.revision,changeId,action,targetWikiId},new AbortController().signal);
 d=await prepare('change-0','update',target.id);
 d=await prepare('change-1','update',target.id);
 assert.equal(d.maintenance!.changes.length,1);assert.equal(d.maintenance!.changes[0].changeId,'change-0');assert.deepEqual(d.maintenance!.changes[0].pageIndexes,[0,1]);
 assert.equal((await f.wiki.get(target.id))!.revision,1);
 d=await prepare('change-0','create');
 const created=d.maintenance!.changes[0];assert.equal(created.targetWikiId,undefined);assert(!created.candidate.body.includes('人工目标专属内容'));assert.deepEqual(created.candidate.sources,[raw.id]);
 d=await prepare('change-0','link',target.id);
 assert.equal(d.maintenance!.changes[0].candidate.body,target.body);
 await assert.rejects(prepare('change-0','noop',target.id),{code:'INVALID_NOOP'});
 const ended=await f.runner.finishReview(d.id,d.revision);
 assert.equal(ended.status,'discarded');assert.equal(ended.maintenance!.changes.length,1);assert.deepEqual(await f.wiki.get(target.id),target);
});

