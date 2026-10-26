// SYNTHETIC, offline engineering checks. Never reopens real attempt 242.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import express from 'express';
import {installOfflineGuard} from './SYN01-PREP-20261025-core.mjs';
import {synthesisFixture} from './SYN01-FIX-20261026-fake.ts';

const guard=installOfflineGuard();
const {RawStore}=await import('../../services/raw/store.ts');
const {WikiStore}=await import('../../services/wiki/store.ts');
const {DraftStore}=await import('../../services/wiki/drafts.ts');
const {KnowledgeWorkflowStore}=await import('../../services/wiki/knowledge-workflows.ts');
const {registerKnowledgeRoutes}=await import('../../server/knowledge-api.ts');
const sha=s=>createHash('sha256').update(s).digest('hex');
const exportPath='docs/reports/SYN01-REAL-20261025-export-1792936917825.json';
const originalBytes=await fs.readFile(exportPath),exp=JSON.parse(originalBytes);
assert.equal(sha(originalBytes),'17b8eb6db27db107f01cca85addbf56c7f476d977a44682530b1beffeca21978');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'SYN01-FIX-20261026-'));
assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
assert(path.basename(root).startsWith('SYN01-FIX-20261026-'));
const raws=new RawStore(root),wiki=new WikiStore(root,raws),drafts=new DraftStore(root),store=new KnowledgeWorkflowStore(root,wiki,raws);
let server,base;
const rows=[],started=Date.now();
const add=(id,detail)=>rows.push({id,...detail});
const fixture=JSON.parse(await fs.readFile('tests/acceptance/SYN01-PREP-20261025-fixtures.json','utf8'));
const samples=[],requests=[];
const authored=entries=>({title:'SYNTHETIC 清禾双来源综合',category:'metric',suggestedAdditions:[],
  agreement:entries.map(raw=>({text:'目标门店100家；铺货率=在售门店数/目标门店数；AI仅未来建议、未上线、收益未知。',rawId:raw.id,start:0,end:raw.body.length})),
  conflicts:entries.map((raw,i)=>({text:i===0?'资料A在售20家，铺货率20%。':'资料B在售30家，铺货率30%。',rawId:raw.id,start:0,end:raw.body.length})),
  inferences:['两份数值差异原因不能由原文确定。'],openQuestions:['异常审批负责人尚未确认。','两个资料采样日是否一致尚未确认。']});
let reply=request=>synthesisFixture(request,authored(JSON.parse(request.user).raws));
let finishReason='stop',secrets=[];
const provider={name:'SYNTHETIC-offline',model:'SYN01-FIX',get secrets(){return secrets;},async complete(request){requests.push(request);return {text:typeof reply==='string'?reply:JSON.stringify(reply(request)),finishReason,bytes:1};}};
const run=()=>store.createSynthesis({rawIds:samples.map(r=>r.id),provider});
async function reject(name,mutate,code='LLM_SCHEMA_INVALID'){
  const before=(await store.list()).length,calls=requests.length;
  reply=request=>{const out=synthesisFixture(request,authored(JSON.parse(request.user).raws));mutate(out,JSON.parse(request.user));return out;};
  await assert.rejects(run(),{code},name);assert.equal(requests.length,calls+1);assert.equal((await store.list()).length,before);
  add('F03-'+name,{code,workflowWrites:0});
}
try{
  for(const s of [raws,wiki,drafts,store])await s.initialize();
  for(const s of fixture.raws)samples.push(await raws.create({title:s.title,sourceType:'report',sourceName:'SYNTHETIC',tags:['SYNTHETIC'],body:s.body}));
  const initialRaw=await Promise.all(samples.map(r=>raws.get(r.id)));
  reply=exp.artifacts.response.text;
  await assert.rejects(run(),{code:'LLM_SCHEMA_INVALID'});assert.equal((await store.list()).length,0);
  add('F01-original-unchanged',{code:'LLM_SCHEMA_INVALID',workflowWrites:0,originalSha256:sha(originalBytes)});

  reply=request=>synthesisFixture(request,authored(JSON.parse(request.user).raws));
  const flow=await run(),request=requests.at(-1),input=JSON.parse(request.user);
  assert.equal(input.synthesis_format_version,1);assert.deepEqual(input.categories,(await wiki.schema()).categories.map(({id,label})=>({id,label})));
  assert.deepEqual(input.raws.map(r=>[r.id,r.title,r.body,r.bodySha256]),samples.map(r=>[r.id,r.title,r.body,r.bodySha256]));
  assert.notEqual(input.raws[0].locators[0].id,input.raws[1].locators[0].id);
  for(const r of input.raws){assert.equal(r.locators.map(l=>l.text).join(''),r.body);assert(r.locators.length<=256);for(const l of r.locators){assert.match(l.id,/^raw-[a-f0-9]{64}-\d+$/);assert.equal(r.body.slice(l.start,l.end),l.text);assert(l.end-l.start<=512);}}
  for(const e of flow.evidence){const raw=input.raws.find(r=>r.id===e.rawId),l=raw.locators[0];assert.deepEqual(Object.keys(e).sort(),['section','text','rawId','quote','start','end'].sort());assert.equal(e.quote,l.text);assert.equal(e.start,l.start);assert.equal(e.end,l.end);}
  assert(!JSON.stringify(flow).includes('locatorId'));assert(!Object.hasOwn(flow,'synthesis_format_version'));
  assert(flow.sections.agreement.every(x=>x.includes('100')&&x.includes('未来')&&x.includes('未上线')&&x.includes('未知')));
  assert(flow.sections.conflicts[0].includes('20%'));assert(flow.sections.conflicts[1].includes('30%'));assert.equal(flow.sections.openQuestions.length,2);
  add('F02-new-protocol',{synthetic:true,workflowId:flow.id,evidenceCount:flow.evidence.length,categories:input.categories.length});

  const mutations=[
    ['missing-array',o=>delete o.suggestedAdditions],['missing-version',o=>delete o.synthesis_format_version],['wrong-version',o=>o.synthesis_format_version=2],['string-version',o=>o.synthesis_format_version='1'],
    ['extra-top',o=>o.extra=true],['extra-item',o=>o.agreement[0].extra=true],['invalid-category',o=>o.category='铺货率数据核对'],['missing-title',o=>delete o.title],
    ['empty-text',o=>o.agreement[0].text=' '],['long-text',o=>o.agreement[0].text='字'.repeat(4001)],['null-item',o=>o.agreement[0]=null],['wrong-array',o=>o.conflicts={}],['wrong-question',o=>o.openQuestions=[{}]],['empty-id',o=>o.agreement[0].locatorId=''],
    ['unknown-id',o=>o.agreement[0].locatorId='raw-unknown','EVIDENCE_INVALID'],['unknown-raw',o=>o.agreement[0].rawId=randomUUID(),'EVIDENCE_INVALID'],
    ['other-raw-anchor',(o,i)=>o.agreement[0].locatorId=i.raws[1].locators[0].id,'EVIDENCE_INVALID'],
    ['wrong-raw',(o,i)=>o.agreement[0].rawId=i.raws[1].id,'EVIDENCE_INVALID'],
    ['old-body-id',(o,i)=>o.agreement[0].locatorId=`raw-${sha(JSON.stringify([i.raws[0].id,sha(i.raws[0].body+'旧正文')]))}-1`,'EVIDENCE_INVALID'],
    ['legacy-item',o=>o.agreement[0]={text:'legacy',rawId:samples[0].id,quote:samples[0].body,start:0,end:samples[0].body.length}],
    ['mixed-offset',o=>o.agreement[0].end=22],
  ];
  for(const [name,mutate,code]of mutations)await reject(name,mutate,code);
  finishReason='length';await reject('length',()=>{},'LLM_OUTPUT_TRUNCATED');finishReason='stop';
  secrets=['SYNTHETIC_KNOWN_SECRET'];await reject('response-secret',o=>o.inferences=[secrets[0]],'LLM_OUTPUT_CONTAINS_SECRET');secrets=[];

  // Controlled invalid Raw snapshots test only the before-provider gates.
  const nativeGet=raws.get.bind(raws),snapshot=samples[0];
  for(const [name,change,code]of [
    ['sha',r=>({...r,bodySha256:'0'.repeat(64)}),'RAW_HASH_MISMATCH'],
    ['restricted',r=>({...r,origin:{invalid:true}}),'MEETING_SOURCE_RESTRICTED'],
    ['empty',r=>({...r,body:'',bodySha256:sha('')}),'LLM_EVIDENCE_CATALOG_INVALID'],
    ['catalog-limit',r=>({...r,body:'x'.repeat(512*256+1),bodySha256:sha('x'.repeat(512*256+1))}),'LLM_EVIDENCE_CATALOG_LIMIT'],
  ]){
    const calls=requests.length,count=(await store.list()).length;
    raws.get=async id=>id===snapshot.id?change(snapshot):nativeGet(id);
    try{await assert.rejects(run(),{code});}finally{raws.get=nativeGet;}
    assert.equal(requests.length,calls);assert.equal((await store.list()).length,count);add('F03-pre-'+name,{code,providerCalls:0});
  }
  const secretRaw=await raws.create({title:'SYNTHETIC 秘密负例',sourceType:'report',sourceName:'SYNTHETIC',tags:[],body:'仅测试派生引文中的 SYNTHETIC_KNOWN_SECRET。'});
  secrets=['SYNTHETIC_KNOWN_SECRET'];reply=request=>{const i=JSON.parse(request.user),r=i.raws[0];return {synthesis_format_version:1,title:'SYNTHETIC',category:'other',suggestedAdditions:[{text:'普通摘要',rawId:r.id,locatorId:r.locators[0].id}],agreement:[],conflicts:[],inferences:[],openQuestions:[]};};
  const count=(await store.list()).length;
  await assert.rejects(store.createSynthesis({rawIds:[secretRaw.id,samples[1].id],provider}),{code:'LLM_OUTPUT_CONTAINS_SECRET'});assert.equal((await store.list()).length,count);secrets=[];
  add('F03-derived-secret',{code:'LLM_OUTPUT_CONTAINS_SECRET',workflowWrites:0});

  // Choose the SECOND equal quote explicitly by ID, including UTF-16 emoji coverage.
  const repeatedBody='同句。\n'+'x'.repeat(506)+'\n同句。\n😀尾句。';
  const repeatedRaw=await raws.create({title:'SYNTHETIC 重复句emoji',sourceType:'report',sourceName:'SYNTHETIC',tags:[],body:repeatedBody});
  let selected,emoji;
  reply=request=>{const i=JSON.parse(request.user),r=i.raws[0],matches=r.locators.filter(l=>l.text.includes('同句。'));assert.equal(matches.length,2);selected=matches[1];emoji=r.locators.find(l=>l.text.includes('😀'));assert(emoji);return {synthesis_format_version:1,title:'SYNTHETIC 重复句',category:'other',suggestedAdditions:[],conflicts:[],agreement:[{text:'第二处同句',rawId:r.id,locatorId:selected.id},{text:'emoji尾句',rawId:r.id,locatorId:emoji.id}],inferences:[],openQuestions:[]};};
  const repeatedFlow=await store.createSynthesis({rawIds:[repeatedRaw.id,samples[1].id],provider});
  assert.equal(repeatedFlow.evidence[0].start,selected.start);assert(selected.start>0);assert.equal(repeatedFlow.evidence[0].quote,selected.text);assert.equal(repeatedBody.slice(selected.start,selected.end),selected.text);
  assert.equal(repeatedFlow.evidence[1].quote,emoji.text);assert.equal(repeatedFlow.evidence[1].start,emoji.start);assert.equal(repeatedBody.slice(emoji.start,emoji.end),emoji.text);assert(!/[\uD800-\uDBFF]$/u.test(emoji.text));assert(!/^[\uDC00-\uDFFF]/u.test(emoji.text));
  add('F02-repeat-emoji',{synthetic:true,start:selected.start,end:selected.end,selectedId:selected.id,emojiStart:emoji.start,emojiEnd:emoji.end});

  reply=request=>synthesisFixture(request,authored(JSON.parse(request.user).raws));
  const app=express();app.use(express.json());registerKnowledgeRoutes(app,{root,raws,wiki,drafts,provider:()=>provider});
  // Read-only test glue delegates directly to the production WikiStore.
  app.get('/api/wiki/:id',async(q,r,n)=>{try{r.json(await wiki.get(q.params.id));}catch(e){n(e);}});
  app.use((e,_q,r,_n)=>r.status(e.status??500).json({error:{code:e.code,message:e.message}}));
  server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  base=`http://127.0.0.1:${server.address().port}`;guard.allowed.add(base);
  async function http(url,body,status=200){const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
  async function reviewConfirm(w,key){
    const blocked=await http(`/api/knowledge/workflows/${w.id}/confirm`,{baseRevision:w.revision,idempotencyKey:key+'-blocked'},409);assert.equal(blocked.error.code,w.humanReview?'HUMAN_REVIEW_INCOMPLETE':'HUMAN_REVIEW_REQUIRED');
    w=await http(`/api/knowledge/workflows/${w.id}/review/start`,{baseRevision:w.revision});
    w=await http(`/api/knowledge/workflows/${w.id}/review/pages/${w.id}`,{baseRevision:w.revision,reviewContentDigest:w.reviewContentDigest,confirmed:true});
    return http(`/api/knowledge/workflows/${w.id}/confirm`,{baseRevision:w.revision,idempotencyKey:key},201);
  }
  const created=await http('/api/knowledge/syntheses',{rawIds:samples.map(r=>r.id)},201),done=await reviewConfirm(created,'SYNTHETIC-new');
  const page=await http('/api/wiki/'+done.wikiId);assert.equal(page.type,'synthesis');assert.deepEqual(page.sources,samples.map(r=>r.id));
  const formal=await wiki.allRecords();assert.equal(formal.filter(p=>p.type==='source').length,2);assert.equal(formal.filter(p=>p.type==='synthesis').length,1);
  for(const source of formal.filter(p=>p.type==='source')){const reread=await http('/api/wiki/'+source.id);assert.equal(reread.sources.length,1);assert(samples.some(r=>r.id===reread.sources[0]));}
  assert(page.body.includes('20%')&&page.body.includes('30%')&&page.body.includes('100')&&page.body.includes('采样日')&&page.body.includes('负责人')&&page.body.includes('未上线'));
  assert.deepEqual(await Promise.all(samples.map(r=>raws.get(r.id))),initialRaw);
  add('F04-http-new',{synthetic:true,explicitReview:true,sourceCount:2,synthesisCount:1,rawsUnchanged:true});

  const legacy={id:randomUUID(),kind:'synthesis',status:'pending_confirmation',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),provider:{name:'SYNTHETIC-old',model:'legacy'},rawSnapshots:samples.map(r=>({id:r.id,title:r.title,bodySha256:r.bodySha256})),title:'SYNTHETIC 旧持久化综合',category:'metric',sources:samples.map(r=>r.id),sections:{suggestedAdditions:[],conflicts:[],agreement:['目标100家。'],inferences:[],openQuestions:[],sourceList:samples.map(r=>({id:r.id,title:r.title}))},evidence:[{section:'agreement',text:'目标100家。',rawId:samples[0].id,quote:samples[0].body,start:0,end:samples[0].body.length}]};
  await store.save(legacy);const file=path.join(root,'drafts/knowledge-workflows',legacy.id+'.json'),bytes=await fs.readFile(file),calls=requests.length;
  const read=await http('/api/knowledge/workflows/'+legacy.id);assert.equal(sha(await fs.readFile(file)),sha(bytes));assert(!read.humanReview);const legacyDone=await reviewConfirm(read,'SYNTHETIC-old');assert.equal((await http('/api/wiki/'+legacyDone.wikiId)).type,'synthesis');assert.equal(requests.length,calls);
  assert.deepEqual(await Promise.all(samples.map(r=>raws.get(r.id))),initialRaw);
  add('F04-old-persisted',{synthetic:true,readDoesNotRewrite:true,explicitReview:true,providerCalls:0});
  assert.equal(sha(await fs.readFile(exportPath)),sha(originalBytes));
  console.log(JSON.stringify({kind:'SYNTHETIC_SELF_CHECK_NOT_INDEPENDENT_ACCEPTANCE',node:process.version,elapsedMs:Date.now()-started,rows,realCalls:0,actualConfigReads:0,guardObserved:guard.observed,originalSha256:sha(originalBytes)},null,2));
}finally{
  if(server){await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));guard.allowed.delete(base);}
  guard.restore();
  // The checked prefix and parent above bind recursive cleanup to our own temp root.
  await fs.rm(root,{recursive:true,force:true});
}
