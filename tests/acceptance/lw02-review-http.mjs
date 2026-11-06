import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import express from 'express';
import {lw02Fixture} from '../lw02-fixture.ts';import {registerKnowledgeRoutes} from '../../server/knowledge-api.ts';
test('review LW02 public HTTP: real citation, unknown citation, stale basis and cached permission revocation',async()=>{
 const f=await lw02Fixture(),raw=await f.rawStore.create({title:'HTTP独验原文',sourceType:'report',sourceName:'合成',tags:[],body:'有效门店统计81家。'}),wiki=await f.seed('HTTP渠道原页','有效门店统计81家。',[raw.id]);
 const app=express();app.use(express.json());registerKnowledgeRoutes(app,{root:f.root,raws:f.rawStore,wiki:f.wiki,drafts:f.drafts,provider:()=>f.provider});app.use((e,req,res,next)=>res.status(e.status??500).json({error:{code:e.code,message:e.message}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(route,body)=>fetch(base+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 try{
  const input={requestId:randomUUID(),question:'有效门店统计有多少？'},response=await request('/api/knowledge/answers',input);assert.equal(response.status,200);const answer=await response.json();assert.equal(answer.status,'completed');
  const citation=await request(`/api/knowledge/answers/${answer.id}/citations/${answer.citations[0].id}`);assert.equal(citation.status,200);assert.equal((await citation.json()).recordId,wiki.id);assert.equal((await request(`/api/knowledge/answers/${answer.id}/citations/fake`)).status,404);
  await f.wiki.update(wiki.id,wiki.revision,{...wiki,body:wiki.body+'\n人工修订口径'});const calls=f.requests.length,save={key:'http-stale',resultRevision:answer.revision,preview:f.preview(answer)};
  const stale=await request(`/api/knowledge/answers/${answer.id}/save`,save);assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'ANSWER_BASIS_CHANGED');assert.equal(f.requests.length,calls);
  const get=f.rawStore.get.bind(f.rawStore);f.rawStore.get=async id=>{const p=await get(id);return id===raw.id?{...p,origin:{invalid:true}}:p;};
  for(const [route,body]of [[`/api/knowledge/answers/${answer.id}`,null],['/api/knowledge/answers/current',null],['/api/knowledge/answers',input],[`/api/knowledge/answers/${answer.id}/citations/${answer.citations[0].id}`,null],[`/api/knowledge/answers/${answer.id}/save`,save]]){const r=await request(route,body);assert(r.status>=400);const payload=await r.json();assert(!JSON.stringify(payload).includes('有效门店统计81家'));}
  assert.equal(f.requests.length,calls);assert.equal((await f.drafts.listKnowledge()).length,0);
 }finally{await new Promise(r=>server.close(r));}
});
