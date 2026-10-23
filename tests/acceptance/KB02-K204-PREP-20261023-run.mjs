import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {storageFixture} from '../support/kb02-storage-fixture.ts';
import {storageHttp} from '../support/kb02-storage-http.ts';
import {ExtractionRunner} from '../../services/llm/jobs.ts';
import {ExtractionCheckpointStore} from '../../services/llm/checkpoints.ts';
import {LLMService} from '../../services/llm/service.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
import {approveWorkflow} from '../support/human-review.ts';
import {P,sha,save,offlineArgs,frozen,guardNetwork,fakeReply,businessRanges,assertFakeDispatch} from './KB02-K204-PREP-20261023-support.mjs';
import {gates} from './KB02-K204-PREP-20261023-gates.mjs';

offlineArgs();
const tag='run-'+new Date().toISOString().replace(/[:.]/g,'-');
const report={startedAt:new Date().toISOString(),node:process.version,realCalls:0,fakeCalls:0,rows:[],actions:[],candidates:{},final:{},limitations:['React/jsdom + actual localhost HTTP, no Chrome/browser-engine evidence','All generated responses are fake; real quality NOT_RUN','Future real runner is not implemented by this preparation'],pass:false};
const network=guardNetwork();let f,h,runner,root,dom,act,createRoot,createElement,DraftReviewPage,KnowledgeWorkflowPage;
let active,jobId,updateCalls=0;const trace=[],jobIds=[],extraRoots=[],protectedBefore={};
const row=(name,detail={})=>report.rows.push({name,pass:true,...detail});
async function protect(){const old=JSON.parse(await fs.readFile('docs/reports/KB02-HUMAN-AUDIT-20261023-engineering.json','utf8'));for(const file of Object.keys(old.expected))protectedBefore[file]=sha(await fs.readFile(file));return Object.keys(protectedBefore).length;}
const buttons=label=>[...dom.window.document.querySelectorAll('button')].filter(b=>b.textContent.trim()===label);
const text=()=>dom.window.document.body.textContent;
async function wait(check,label){const end=Date.now()+10000;while(Date.now()<end){await act(async()=>{await new Promise(r=>setTimeout(r,15));});if(check())return;}throw Error('UI timeout '+label+' '+text().slice(0,650));}
async function click(button){assert(button&&!button.disabled,'Enabled button required');await act(async()=>{button.click();});await wait(()=>![...dom.window.document.querySelectorAll('button')].some(b=>['确认本页主题与归属','确认本页主题与完整归属','保存草稿'].includes(b.textContent.trim())&&b.disabled),'request settled');}
async function change(element,value){assert(element);const w=dom.window;await act(async()=>{const proto=element instanceof w.HTMLSelectElement?w.HTMLSelectElement.prototype:element instanceof w.HTMLTextAreaElement?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new w.Event('change',{bubbles:true}));if(!(element instanceof w.HTMLSelectElement))element.dispatchEvent(new w.Event('input',{bubbles:true}));});}
async function unmount(){if(root){await act(async()=>root.unmount());root=undefined;}}
async function mount(component,props,check){await unmount();root=createRoot(dom.window.document.getElementById('root'));await act(async()=>root.render(createElement(component,props)));await wait(check,'mount');}
async function request(url,method='GET',body,status=200){const res=await fetch(h.base+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const json=await res.json();assert.equal(res.status,status,JSON.stringify(json.error));report.actions.push({kind:'HTTP',method,url,status:res.status});return json;}
async function approveUI(draft){await mount(DraftReviewPage,{draftId:draft.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{}},()=>buttons('确认本页主题与归属').length===draft.pages.length);for(let i=0;i<draft.pages.length;i++){await click(buttons('确认本页主题与归属')[i]);report.actions.push({kind:'test-human-page-review',draftId:draft.id,pageId:draft.pages[i].pageId});}return f.drafts.get(draft.id);}
async function extracted(id) {
  active=fixtures.find(x=>x.id===id);const sample=spec.samples.find(x=>x.id===id),raw=await f.rawStore.create({title:'K204离线 '+id,sourceType:'report',sourceName:'隔离虚构',tags:['KB02'],body:active.body});
  jobId=randomUUID();jobIds.push(jobId);assert.equal(await new ExtractionCheckpointStore(f.root).get(jobId),undefined);const start=trace.length;
  const started=await runner.start(raw.id,{newJobId:jobId,now:new Date().toISOString()});assert.equal(started.job.id,jobId);await runner.waitForSettlement(jobId);const job=await f.jobs.get(jobId);assert.equal(job.status,'completed',JSON.stringify(job.error));
  let draft=await f.drafts.get(job.draftId),cp=await new ExtractionCheckpointStore(f.root).get(jobId);assert.equal(trace.length-start,sample.normalExtractionCalls);assert.equal(cp.attempts,sample.normalExtractionCalls);assert.equal(cp.completedChunks.length,sample.chunks.length);assert.equal(draft.humanReview.approvals.length,0);
  assert.deepEqual(draft.humanReview.units.flatMap(u=>u.memberIds).sort(),cp.completedChunks.flatMap(c=>[...c.facts,...c.questions].map(x=>x.id)).sort());assert.equal(new Set(draft.humanReview.units.map(u=>u.id)).size,draft.humanReview.units.length);
  for(const u of draft.humanReview.units){assert(draft.pages.some(p=>p.pageId===draft.humanReview.assignments[u.id]));for(const e of u.evidence){assert.equal(e.rawId,raw.id);assert.equal(active.body.slice(e.start,e.end),e.quote);}}
  report.candidates[id]={rawId:raw.id,rawSha256:sha(active.body),job:structuredClone(job),checkpoint:cp,draft:structuredClone(draft)};
  row(id+' fresh checkpoint extraction + planning',{fakeCalls:sample.normalExtractionCalls,units:draft.humanReview.units.length,memberIds:draft.humanReview.units.flatMap(u=>u.memberIds).length});return {raw,draft,cp};
}
async function cloneNegative(name,callback){await unmount();const clone=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-k204-negative-'));extraRoots.push(clone);await fs.cp(f.root,clone,{recursive:true});const raws=new (await import('../../services/raw/store.ts')).RawStore(clone);await raws.initialize();const wiki=new WikiStore(clone,raws);await wiki.initialize();const service=new KnowledgeWorkflowStore(clone,wiki,raws);await service.initialize();await callback({root:clone,raws,wiki,service,drafts:new DraftStore(clone)});row(name,{isolatedClone:true});}
let spec,fixtures,bundle;
try{
  ({spec,fixtures,bundle}=await frozen());report.protectedPaths=await protect();
  await save(tag+'-plan',{status:'PLAN_ONLY_REAL_AUTHORIZATION_ZERO',knowledgeUsed:219,prompt:'15/24',maximumProposed:22,maximumCumulative:241,stages:spec.stages,updateLimits:{timeoutMs:90000,maxOutputBytes:256000},realRunnerImplemented:false,dynamicRequestNote:'Future actual planning/update bytes require durable input reload and pre-send hash review; oracle/spec must not be sent.'});row('P01 frozen card/source/code/rules/body/chunks and22-call proposal');
  await assert.rejects(async()=>fetch('https://example.invalid/'),/OFFLINE_NETWORK_DENIED/);assert.throws(()=>requireHttp.get('http://example.invalid/'),/OFFLINE_NETWORK_DENIED/);
  f=await storageFixture();const cpStore=new ExtractionCheckpointStore(f.root);
  f.provider.complete=async req=>{
    if(req.system.startsWith('你是知识更新建议器')){
      assert.equal(updateCalls++,0,'Only one A3 fake update request');assert.equal(req.timeoutMs,90000);assert.equal(req.maxOutputBytes,256000);const input=JSON.parse(req.user);assert(!req.user.includes('originalOracle'));
      const e=input.newSource.evidence.find(e=>e.quote.includes('30')),old=input.existing.locators.find(e=>e.text.includes('100'));assert(e&&old);
      const output={suggestedAdditions:[],conflicts:[{text:'旧目标记录在售20家、铺货率20%；补充来源记录在售30家、铺货率30%。口径或采样时间差异待确认，不能静默覆盖任何一方。',evidenceId:e.id}],inferences:[],openQuestions:['两份来源的具体采样时间与统计口径是否一致？'],agreement:[{text:'虚构饮料甲甲桥区域2026年9月目标门店100家。',evidenceId:e.id,existingLocatorId:old.id}]};
      trace.push({stage:'update',sample:'A3',requestHash:sha(req.user),timeoutMs:req.timeoutMs,maxOutputBytes:req.maxOutputBytes,input,output});return {text:JSON.stringify(output),bytes:Buffer.byteLength(JSON.stringify(output)),finishReason:'stop'};
    }
    const seen=trace.filter(t=>t.sample===active.id).length;assertFakeDispatch(req,active,seen,spec.samples.find(s=>s.id===active.id).normalExtractionCalls);
    const cp=await cpStore.get(jobId);assert(cp);assert.equal(cp.attempts,seen+1,'Product durable attempt precedes fake complete');if(!seen)assert.equal(cp.completedChunks.length,0,'Empty new cp');
    return fakeReply(req,active,trace);
  };
  runner=new ExtractionRunner({root:f.root,jobs:f.jobs,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore,rulesDir:'rules',provider:()=>f.provider,llm:new LLMService('rules'),draftRules:async()=>({types:bundle.fmcg.types.map(t=>t.id),categories:bundle.fmcg.categories.map(t=>t.id),...bundle.fmcg.enums})});
  h=await storageHttp(f,runner,{knowledge:true});network.allow(h.base);report.fixtureRoot=f.root;
  dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:h.base,pretendToBeVisual:true});const w=dom.window;
  for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  ({act,createElement}=await import('react'));({createRoot}=await import('react-dom/client'));({DraftReviewPage}=await import('../../app/pages/DraftReviewPage.tsx'));({KnowledgeWorkflowPage}=await import('../../app/pages/KnowledgeWorkflowPage.tsx'));
  const guardedFetch=globalThis.fetch;globalThis.fetch=(url,init)=>guardedFetch(String(url).startsWith('/api/')?h.base+url:url,init);
  const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const service=new KnowledgeWorkflowStore(f.root,wiki,f.rawStore);await service.initialize();
  const a1=await extracted('explicit-metric-target');assert(a1.draft.pages.some(p=>p.type==='metric'));await request(`/api/drafts/${a1.draft.id}/confirm`,'POST',{baseRevision:a1.draft.revision,selectedPageIds:[a1.draft.pages[0].pageId],idempotencyKey:randomUUID()},409);assert.equal((await wiki.allRecords()).length,0);
  a1.draft=await request(`/api/drafts/${a1.draft.id}`,'PATCH',{baseRevision:a1.draft.revision,pages:[{pageId:a1.draft.pages[0].pageId,ai_organized:[spec.humanMemo]}]});
  let committed=0;await mount(DraftReviewPage,{draftId:a1.draft.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{committed++;}},()=>buttons('确认本页主题与归属').length===a1.draft.pages.length);assert(text().includes(a1.raw.body));assert([...w.document.querySelectorAll('.draft-line textarea')].some(t=>t.readOnly));
  await act(async()=>w.document.querySelector('.draft-card-head .draft-select input').click());await click(buttons('保存草稿')[0]);for(let i=0;i<a1.draft.pages.length;i++)await click(buttons('确认本页主题与归属')[i]);await click([...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('确认写入 Wiki')));await wait(()=>committed===1,'A1 explicit formal create');await unmount();
  let target=(await wiki.allRecords()).find(x=>x.type==='metric'&&x.sources.includes(a1.raw.id));assert(target);assert(target.body.includes(spec.humanMemo));for(const s of ['门店数÷目标门店数×100%','零','销量','销售额','未注明'])assert(target.body.includes(s),s);const targetBefore=structuredClone(target);row('A1 actual DraftReviewPage creates reviewed metric target',{wikiId:target.id,revision:target.revision});
  const a2=await extracted('supplement-original');assert.equal(a2.draft.pages.length,2);const page=a2.draft.pages[0];
  const update=()=>request('/api/knowledge/updates','POST',{draftId:a2.draft.id,pageId:page.pageId,targetWikiId:target.id,baseRevision:a2.draft.revision},409);
  await update();assert.equal(updateCalls,0);a2.draft=await approveUI(a2.draft);const oldDigest=f.drafts.contentDigest(a2.draft),oldRevision=a2.draft.revision;
  a2.draft=await request(`/api/knowledge/drafts/${a2.draft.id}/pages/${page.pageId}/decision`,'PATCH',{baseRevision:a2.draft.revision,decision:'update',targetWikiId:target.id}).then(()=>f.drafts.get(a2.draft.id));assert.equal(a2.draft.humanReview.approvals.length,0);await update();assert.equal(updateCalls,0);
  await request(`/api/drafts/${a2.draft.id}/review/pages/${page.pageId}`,'POST',{baseRevision:oldRevision,reviewContentDigest:oldDigest,confirmed:true},409);
  const unit=a2.draft.humanReview.units[0];a2.draft=await request(`/api/drafts/${a2.draft.id}/review/move`,'POST',{baseRevision:a2.draft.revision,unitIds:[unit.id],pageId:null});await update();assert.equal(updateCalls,0);a2.draft=await request(`/api/drafts/${a2.draft.id}/review/move`,'POST',{baseRevision:a2.draft.revision,unitIds:[unit.id],pageId:page.pageId});
  a2.draft=await approveUI(a2.draft);const immutableA2=structuredClone(a2.draft.humanReview.units);let flow;
  await click(buttons('刷新重复候选')[0]);await wait(()=>buttons('生成旧 Wiki 更新预览').length===1,'selected target visible');
  // The saved decision and complete re-review above are prerequisites for this real component action.
  let opened;await unmount();await mount(DraftReviewPage,{draftId:a2.draft.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{},onOpenWorkflow:id=>{opened=id;}},()=>buttons('确认本页主题与归属').length===2);await click(buttons('刷新重复候选')[0]);await wait(()=>buttons('生成旧 Wiki 更新预览').length===1,'preview action');await click(buttons('生成旧 Wiki 更新预览')[0]);await wait(()=>!!opened,'A3 created');await unmount();flow=await service.get(opened);assert.equal(updateCalls,1);assert.equal(flow.humanReview.approvals.length,0);assert.deepEqual(await wiki.get(target.id),targetBefore);report.candidates.update=structuredClone(flow);row('A2 decision clears all approvals; full re-review then one actual UI A3 preview',{fakeUpdateCalls:updateCalls});
  await cloneNegative('Nonselected input revoke blocks output confirmation',async n=>{let x=await approveWorkflow(n.service,flow.id);const d=await n.drafts.get(a2.draft.id);await n.drafts.reviewOperation(d.id,{action:'page',baseRevision:d.revision,pageId:d.pages[1].pageId,reviewContentDigest:n.drafts.contentDigest(d),confirmed:false},{body:a2.raw.body,rulesDir:'rules'});await assert.rejects(n.wiki.withLock(()=>n.service.confirm(x.id,x.revision,randomUUID())),e=>['INPUT_REVIEW_CHANGED','HUMAN_REVIEW_INCOMPLETE'].includes(e.code));assert.deepEqual(await n.wiki.get(target.id),targetBefore);});
  await cloneNegative('Target revision change blocks preview confirmation',async n=>{const x=await approveWorkflow(n.service,flow.id),t=await n.wiki.get(target.id);await n.wiki.update(t.id,t.revision,{...t,body:t.body+'\n隔离目标变化'});await assert.rejects(n.wiki.withLock(()=>n.service.confirm(x.id,x.revision,randomUUID())));assert((await n.wiki.get(target.id)).body.endsWith('隔离目标变化'));});
  let done=0;const mountFlow=()=>mount(KnowledgeWorkflowPage,{workflowId:flow.id,onBack:()=>{},onDone:async()=>{done++;}},()=>buttons('确认本页主题与完整归属').length===1||text().includes(' · confirmed'));await mountFlow();assert(text().includes('旧目标记录在售20家'));assert([...w.document.querySelectorAll('textarea')].some(e=>e.value===targetBefore.body&&e.readOnly));
  const firstFlowUnit=flow.humanReview.units[0];await change(w.document.querySelector(`select[aria-label="归属 ${firstFlowUnit.id}"]`),'');await wait(()=>text().includes('未解决 1 项'),'workflow unresolved');await click(buttons('确认写入')[0]);assert.equal(done,0);assert.deepEqual(await wiki.get(target.id),targetBefore);
  await change(w.document.querySelector(`select[aria-label="归属 ${firstFlowUnit.id}"]`),flow.id);await wait(()=>text().includes('未解决 0 项'),'workflow resolved');await click(buttons('确认本页主题与完整归属')[0]);flow=await service.get(flow.id);const staleFlow={baseRevision:flow.revision,idempotencyKey:randomUUID()};
  await change(w.document.querySelector('input'),flow.title+'（人工整理）');await click(buttons('保存草稿')[0]);flow=await service.get(flow.id);assert.equal(flow.humanReview.approvals.length,0);await request(`/api/knowledge/workflows/${flow.id}/confirm`,'POST',staleFlow,409);assert.deepEqual(await wiki.get(target.id),targetBefore);
  await click(buttons('确认本页主题与完整归属')[0]);flow=await service.get(flow.id);const confirmBody={baseRevision:flow.revision,idempotencyKey:randomUUID()};await click(buttons('确认写入')[0]);await wait(()=>done===1,'workflow confirmed');await unmount();await mountFlow();assert(text().includes('confirmed'));await unmount();
  const repeat=await request(`/api/knowledge/workflows/${flow.id}/confirm`,'POST',confirmBody,200);assert(repeat.reused);target=await wiki.get(target.id);assert.equal(target.revision,targetBefore.revision+1);assert.deepEqual([...target.sources].sort(),[a1.raw.id,a2.raw.id].sort());assert(target.body.startsWith(targetBefore.body));for(const token of ['20%','30%','口径或采样时间差异待确认',spec.humanMemo])assert(target.body.includes(token));
  const reopened=new WikiStore(f.root,f.rawStore);await reopened.initialize();assert.deepEqual(await reopened.get(target.id),target);assert.deepEqual((await f.drafts.get(a2.draft.id)).humanReview.units,immutableA2);report.final.update={targetBefore,target,flow:await new KnowledgeWorkflowStore(f.root,reopened,f.rawStore).get(flow.id),repeat};row('P02 actual workflow UI unresolved/save/review/confirm/refresh/disk/idempotency',{noExtraCalls:updateCalls===1});
  for(const id of ['mixed-short-original','long-original']){
    const item=await extracted(id);if(id==='long-original'){
      const ranges=businessRanges(item.raw.body);assert.equal(ranges.length,14);const regions=[];
      for(const [i,r]of ranges.entries()) {const owner=item.draft.pages.find(p=>p.title.startsWith(r.subject));assert(owner);const units=item.draft.humanReview.units.filter(u=>item.draft.humanReview.assignments[u.id]===owner.pageId),records=units.flatMap(u=>u.records),joined=records.map(x=>x.text).join('\n');for(const token of ['2026年9月','100家',`${i+11}家在售`,`${i+11}%`,'独立','未知','未来'])assert(joined.includes(token),r.subject+token);
        const intervals=units.map(u=>{const m=/^[fq]u-(\d+)-(\d+)/.exec(u.id);assert(m);return {start:Number(m[1]),end:Number(m[2])};});for(let pos=r.start;pos<r.end;pos++)assert(intervals.some(x=>x.start<=pos&&x.end>pos),r.subject+' source business gap '+pos);assert(!joined.includes('排版说明'));regions.push({subject:r.subject,range:r,pageId:owner.pageId,units:units.map(u=>u.id),businessCharactersCovered:r.end-r.start,sellingStores:i+11});}
      report.regions=regions;row('P03 14 source regions checked independently of produced IDs',{freshFakeCalls:15,regions:regions.length});
    }
    item.draft=await approveUI(item.draft);await unmount();item.draft=await f.drafts.get(item.draft.id);await f.drafts.assertReviewed(item.draft,item.raw.body);
    const confirmed=await request(`/api/drafts/${item.draft.id}/confirm`,'POST',{baseRevision:item.draft.revision,selectedPageIds:item.draft.pages.map(p=>p.pageId),idempotencyKey:randomUUID()},201);assert(confirmed);assert.equal((await f.rawStore.get(item.raw.id)).body,item.raw.body);report.final[id]={draft:await f.drafts.get(item.draft.id),formal:(await reopened.allRecords()).filter(w=>w.sources.includes(item.raw.id))};assert.equal(report.final[id].formal.filter(w=>w.type!=='source').length,item.draft.pages.length);row(id+' all actual pages reviewed/formal readback');
  }
  assert.equal(trace.length,22);assert.equal(updateCalls,1);report.fakeCalls=trace.length;report.trace=trace;const simulationRoot=await fs.mkdtemp(path.join(os.tmpdir(),'kb02-k204-gates-'));extraRoots.push(simulationRoot);report.gates=await gates(simulationRoot,tag+'-gates');
  row('P04 network blocked; no selectable real transport',{blockedProbes:network.state.blocked,externalSent:network.state.externalSent});row('P05 offline ledger/stop/stage simulations',{checks:report.gates.rows.length});report.pass=true;
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};report.trace=trace;report.fakeCalls=trace.length;console.error(error);process.exitCode=1;}
finally{
  await unmount().catch(e=>{report.cleanupError=e.message;report.pass=false;});if(h)await h.close();if(runner)for(const id of jobIds)await runner.waitForSettlement(id);if(f)await f.clean();for(const dir of extraRoots){assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}if(dom)dom.window.close();network.restore();
  report.network=network.state;report.protectionMismatches=[];for(const [file,hash]of Object.entries(protectedBefore))if(sha(await fs.readFile(file))!==hash)report.protectionMismatches.push(file);if(report.protectionMismatches.length)report.pass=false;report.cleaned={serverClosed:!!h,fixtureRemoved:!!f,negativeAndSimulationRoots:extraRoots.length};report.finishedAt=new Date().toISOString();await save(tag+'-offline',report);console.log(JSON.stringify({report:P+tag+'-offline.json',pass:report.pass,fakeCalls:report.fakeCalls,realCalls:0,error:report.error,network:report.network}));if(!report.pass)process.exitCode=1;
}
import requireHttp from 'node:http';
