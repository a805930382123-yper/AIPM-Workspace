import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {JSDOM} from 'jsdom';
import {storageFixture} from '../support/kb02-storage-fixture.ts';import {storageHttp} from '../support/kb02-storage-http.ts';import {ExtractionRunner} from '../../services/llm/jobs.ts';import {LLMService} from '../../services/llm/service.ts';import {loadExtractionRules} from '../../services/llm/rules.ts';import {DraftStore} from '../../services/wiki/drafts.ts';import {WikiStore} from '../../services/wiki/store.ts';
const prefix='docs/reports/KB02-HUMAN-AUDIT-20261023-';
const fixture=JSON.parse(await fs.readFile('docs/reports/KB02-SEMANTIC-AUDIT-20261023-fixtures.json','utf8')).fixtures.find(f=>f.id==='supplement-original');
const trace=(await fs.readFile('docs/reports/KB02-SEMANTIC-AUDIT-20261023-provider-trace.jsonl','utf8')).trim().split(/\r?\n/).map(JSON.parse);
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
for(const [name,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{DraftReviewPage}=await import('../../app/pages/DraftReviewPage.tsx');
const nativeFetch=globalThis.fetch,rows=[];let external=0,calls=0,root,h,runner,jobId;
const f=await storageFixture();
try{
 const raw=await f.rawStore.create({title:'独立原补充人审',sourceType:'report',sourceName:'虚构离线',tags:[],body:fixture.body});
 const bundle=await loadExtractionRules('rules');const provider={name:'fake',model:'historical-first-response',complete:async()=>{assert(calls<2,'B1 third call forbidden');const sequence=204+calls++;const text=trace.find(t=>t.sequence===sequence).response.content;return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};}};
 runner=new ExtractionRunner({root:f.root,jobs:f.jobs,drafts:f.drafts,rawStates:f.rawStates,rawStore:f.rawStore,rulesDir:'rules',provider:()=>provider,llm:new LLMService('rules'),draftRules:async()=>({types:bundle.fmcg.types.map(t=>t.id),categories:bundle.fmcg.categories.map(t=>t.id),...bundle.fmcg.enums})});
 const started=await runner.start(raw.id,{newJobId:randomUUID(),now:new Date().toISOString()});jobId=started.job.id;
 await runner.waitForSettlement(jobId);const job=await f.jobs.get(jobId);assert.equal(job.status,'completed',JSON.stringify(job.error));
 let d=await f.drafts.get(job.draftId);assert.equal(calls,2);assert.equal(d.humanReview.approvals.length,0);assert.equal(d.pages.length,3);const immutable=structuredClone(d.humanReview.units);
 h=await storageHttp(f,runner,{knowledge:true});
 globalThis.fetch=(url,init)=>{const resolved=String(url).startsWith('/api/')?h.base+url:String(url);if(!resolved.startsWith(h.base+'/')){external++;throw Error('Nonlocal request forbidden');}return nativeFetch(resolved,init);};
 const direct=await h.request(`/api/drafts/${d.id}/confirm`,{baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:randomUUID()});assert.equal(direct.status,409);rows.push({step:'unreviewed direct POST',status:direct.status,error:direct.json.error.code});
 const forged=await nativeFetch(h.base+`/api/drafts/${d.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:d.revision,humanReview:{approvals:[]}})});assert.equal(forged.status,400);rows.push({step:'generic PATCH trusted metadata forgery',status:forged.status});
 const buttons=label=>[...w.document.querySelectorAll('button')].filter(b=>b.textContent.trim()===label);
 async function wait(check,label){const end=Date.now()+8000;while(Date.now()<end){await act(async()=>{await new Promise(r=>setTimeout(r,20));});if(check())return;}throw Error('UI timeout '+label);}
 async function click(b){assert(b&&!b.disabled);await act(async()=>{b.click();});await wait(()=>buttons('确认本页主题与归属').every(b=>!b.disabled),'settled');}
 async function select(id,value){await act(async()=>{const e=w.document.querySelector(`select[aria-label="归属 ${id}"]`);assert(e&&!e.disabled);Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype,'value').set.call(e,value);e.dispatchEvent(new w.Event('change',{bubbles:true}));});await wait(()=>buttons('确认本页主题与归属').every(b=>!b.disabled),'move settled');}
 let committed=0;async function mount(){root=createRoot(w.document.getElementById('root'));await act(async()=>root.render(createElement(DraftReviewPage,{draftId:d.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{committed++;}})));await wait(()=>buttons('确认本页主题与归属').length===d.pages.length,'mount');}
 await mount();assert(w.document.body.textContent.includes(fixture.body));
 const boundary='fu-139-160-fact';await select(boundary,'');await wait(()=>w.document.body.textContent.includes('未解决 1 项'),'unresolved');
 d=await f.drafts.get(d.id);assert.equal(d.humanReview.assignments[boundary],null);
 const blocked=await h.request(`/api/drafts/${d.id}/confirm`,{baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:randomUUID()});assert.equal(blocked.status,409);
 rows.push({step:'actual component move to unresolved and HTTP block',text:w.document.body.textContent,status:blocked.status});
 // Explicit test user's organizational choice, not proof of source semantic relation.
 await select(boundary,d.pages[1].pageId);await click(buttons('删除')[2]);await wait(()=>buttons('确认本页主题与归属').length===2,'remove empty shell');d=await f.drafts.get(d.id);assert.equal(d.pages.length,2);assert.deepEqual(d.humanReview.units,immutable);
 const checks=w.document.querySelectorAll('.draft-card-head .draft-select input');await act(async()=>checks[0].click());await click(buttons('保存草稿')[0]);
 await click(buttons('确认本页主题与归属')[0]);
 d=await f.drafts.get(d.id);const missing=await h.request(`/api/drafts/${d.id}/confirm`,{baseRevision:d.revision,selectedPageIds:[d.pages[0].pageId],idempotencyKey:randomUUID()});assert.equal(missing.status,409);rows.push({step:'unselected second page still blocks',status:missing.status});
 await click(buttons('确认本页主题与归属')[1]);d=await f.drafts.get(d.id);const stale=d.revision,digest=f.drafts.contentDigest(d);
 const edited=await nativeFetch(h.base+`/api/drafts/${d.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:d.revision,pages:[{pageId:d.pages[1].pageId,title:'用户归属的补充业务边界'}]})});assert.equal(edited.status,200);
 const staleReview=await h.request(`/api/drafts/${d.id}/review/pages/${d.pages[0].pageId}`,{baseRevision:stale,reviewContentDigest:digest,confirmed:true});assert.equal(staleReview.status,409);
 await act(async()=>root.unmount());d=await new DraftStore(f.root).get(d.id);assert.equal(d.humanReview.approvals.length,0);await mount();
 for(let i=0;i<2;i++)await click(buttons('确认本页主题与归属')[i]);
 d=await f.drafts.get(d.id);await act(async()=>root.unmount());await mount();
 const final=[...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('确认写入 Wiki'));assert(final&&!final.disabled);await act(async()=>final.click());await wait(()=>committed===1,'explicit final write');
 d=await f.drafts.get(d.id);assert.equal(d.status,'confirmed');const wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();assert.equal((await wiki.allRecords()).length,2);assert.equal((await f.rawStore.get(raw.id)).body,fixture.body);assert.equal(calls,2);assert.equal(external,0);
 rows.push({step:'stale tab refused, refresh approvals persisted, final component confirm persisted',staleStatus:staleReview.status,draftStatus:d.status,formalCount:2,unitCount:immutable.length});
 await fs.writeFile(prefix+'http-ui.json',JSON.stringify({pass:true,realCalls:0,fakeCalls:calls,externalRequests:external,rows,limitations:'Actual React/jsdom components with localhost HTTP; no Chrome session. Test human assignment is explicit choice, not assertion source uniquely entails relation.'},null,2)+'\n');console.log(JSON.stringify({pass:true,fakeCalls:calls,realCalls:0,steps:rows.length}));
}finally{if(root)await act(async()=>root.unmount());globalThis.fetch=nativeFetch;if(h)await h.close();if(jobId)await runner.waitForSettlement(jobId);await f.clean();dom.window.close();}

