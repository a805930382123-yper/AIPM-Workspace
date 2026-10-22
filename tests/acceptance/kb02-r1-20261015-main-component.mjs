// React component + actual isolated HTTP; jsdom evidence, not an actual browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createHarness,expect,terminal,request,rawInput,delay} from './kb02-20261015-standards-harness.mjs';
import {goodReply,payload} from './kb02-20261015-standards-wire.mjs';
import {shortBody} from './kb02-20261015-standards-fixtures.mjs';
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window,doc=w.document;
for(const [name,value]of Object.entries({window:w,document:doc,location:w.location,history:w.history,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLSelectElement:w.HTMLSelectElement,HTMLTextAreaElement:w.HTMLTextAreaElement,Event:w.Event,CustomEvent:w.CustomEvent,MouseEvent:w.MouseEvent,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{RawPage}=await import('../../app/pages/RawPage.tsx');
const checks=[],requests=[],started=Date.now(),h=await createHarness(goodReply);let s,root;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{if(!String(url).startsWith('/api/'))return originalFetch(url,init);requests.push({path:String(url),method:init.method??'GET',body:typeof init.body==='string'?JSON.parse(init.body):undefined});return originalFetch(s.base+url,init);};
const button=text=>[...doc.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
async function tick(fn,label){for(let n=0;n<400;n++){await act(async()=>{await delay(15);});if(fn())return;}throw Error('Component timeout '+label);}
async function unmount(){if(root){await act(async()=>root.unmount());root=null;}}
async function mount(r,job=null){await unmount();const state=(await expect(s,'/api/raw-processing')).items.find(x=>x.rawId===r.id);root=createRoot(doc.querySelector('#root'));await act(async()=>root.render(createElement(RawPage,{items:[r],selectedId:r.id,onSelected:()=>{},onOpenImport:()=>{},onCommitted:async()=>{},openImport:false,onCloseImport:()=>{},onDeleted:async()=>{},processing:{[r.id]:state},job,onJobStarted:()=>{},onOpenDraft:()=>{},onRefresh:async()=>{}})));await tick(()=>!!doc.querySelector('.raw-detail'),'mount');return state;}
async function click(b){assert(b,'Missing button');assert(!b.disabled);await act(async()=>{b.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await delay(0);});}
async function failedRaw(label){h.setReply(w=>payload(w).kind==='planning'?{httpStatus:500}:goodReply(w));const r=await expect(s,'/api/raw','POST',rawInput(label,shortBody),201),start=await expect(s,'/api/raw/'+r.id+'/extract','POST',{},202),j=await terminal(s,start.jobId);assert.equal(j.status,'failed');return {r,j};}
async function test(id,fn){try{checks.push({id,result:'PASS',evidence:await fn()});}catch(e){checks.push({id,result:'FAIL',error:e.stack});}finally{await unmount();}console.log(id+': '+checks.at(-1).result);}
try{
 s=await h.start();
 await test('C01-failed-progress-and-continue-body',async()=>{
  const {r,j}=await failedRaw('KB02组件继续');const n=h.requests.length;await mount(r);await tick(()=>!!button('继续提取'),'resume controls');assert(doc.body.textContent.includes('检查点已验证 1/1'));assert(doc.body.textContent.includes('累计 2 次调用'));assert(!button('继续审核'));assert.equal(h.requests.length,n);h.setReply(goodReply);const k=requests.length;await click(button('继续提取'));await tick(()=>requests.slice(k).some(x=>x.path.endsWith('/extract')),'resume request');const wire=requests.slice(k).find(x=>x.path.endsWith('/extract'));assert.deepEqual(wire.body,{});const done=await terminal(s,j.jobId);assert.equal(done.status,'completed');assert.equal(h.requests.length,n+1);return {sameJob:j.jobId,normalContinueBody:wire.body,onePlanningCall:true,failedProgressVisible:true};
 });
 await test('C02-corrupt-continue-error-and-explicit-restart',async()=>{
  const {r,j}=await failedRaw('KB02组件损坏');await fs.writeFile(path.join(h.dataRoot,'state','extraction-checkpoints',j.jobId+'.json'),'{broken');await mount(r);await tick(()=>!!button('继续提取'),'resume controls');const n=h.requests.length;await click(button('继续提取'));await tick(()=>!!doc.querySelector('[role=alert]'),'error visible');assert.equal(h.requests.length,n);assert(button('明确重新生成'));h.setReply(goodReply);const k=requests.length;await click(button('明确重新生成'));await tick(()=>requests.slice(k).some(x=>x.path.endsWith('/extract')),'restart request');const e=requests.slice(k).find(x=>x.path.endsWith('/extract'));assert.deepEqual(e.body,{restart:true});const state=(await expect(s,'/api/raw-processing')).items.find(x=>x.rawId===r.id);assert(state.jobId);assert.equal((await terminal(s,state.jobId)).status,'completed');return {corruptErrorVisible:true,normalContinueNoCalls:true,explicitRestartBody:e.body};
 });
 await test('C03-live-planning-stage-no-partial-review',async()=>{
  let release,seen=false;const hold=new Promise(r=>release=r);h.setReply(async w=>{if(payload(w).kind==='planning'){seen=true;await hold;}return goodReply(w);});try{const r=await expect(s,'/api/raw','POST',rawInput('KB02组件规划',shortBody),201),b=await expect(s,'/api/raw/'+r.id+'/extract','POST',{},202);await tick(()=>seen,'planning call');const j=await expect(s,'/api/extraction-jobs/'+b.jobId);await mount(r,j);assert(doc.body.textContent.includes('规划整篇主题'));assert(doc.body.textContent.includes('已验证 1/1'));assert(!button('继续审核'));assert.equal((await expect(s,'/api/drafts?rawId='+r.id)).items.length,0);assert(button('取消整理'));release();const done=await terminal(s,b.jobId);assert.equal(done.status,'completed');return {planningVisible:true,validatedCountVisible:true,noPartialDraft:true};}finally{release();}
 });
 await test('C04-reload-failed-checkpoint-readonly',async()=>{
  const {r,j}=await failedRaw('KB02组件重启');await h.stop(s);s=await h.start();const n=h.requests.length;await mount(r);await tick(()=>!!button('继续提取'),'reload continue');assert(doc.body.textContent.includes('检查点已验证 1/1'));assert.equal(h.requests.length,n);return {restoredJob:j.jobId,controlsVisible:true,reloadCalls:0};
 });
}finally{await unmount();globalThis.fetch=originalFetch;w.close();await h.close();const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};await fs.writeFile(`docs/reports/KB02-R1-20261015-standards-component-${process.env.KB02_STANDARDS_RUN??'initial'}.json`,JSON.stringify({at:new Date().toISOString(),scope:'React + actual isolated HTTP in jsdom; not actual browser',durationMs:Date.now()-started,checks,summary,requests,root:h.dataRoot,fakeCalls:h.requests.length,closed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null)},null,2));console.log(summary);if(summary.fail)process.exitCode=1;}


