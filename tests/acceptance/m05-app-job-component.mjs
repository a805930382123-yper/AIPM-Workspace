import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createHarness,expect} from './m05-harness.mjs';
const h=await createHarness(()=>({httpStatus:500})),s=await h.start(),checks=[],requests=[],started=Date.now();
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window,doc=w.document;
for(const [name,value]of Object.entries({window:w,document:doc,location:w.location,history:w.history,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLSelectElement:w.HTMLSelectElement,HTMLTextAreaElement:w.HTMLTextAreaElement,Event:w.Event,MouseEvent:w.MouseEvent,FormData:w.FormData,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{App}=await import('../../app/App.tsx');
const originalFetch=globalThis.fetch;let root,intercept=null;
globalThis.fetch=async(url,init={})=>{const p=String(url);if(!p.startsWith('/api/'))return originalFetch(url,init);const e={path:p,method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})};requests.push(e);const reply=()=>originalFetch(s.base+p,init);return intercept?intercept(e,reply):reply();};
const req=(p,m,b,status=200)=>expect(s,p,m,b,status),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function tick(pred,label){for(let i=0;i<180;i++){await act(async()=>{await delay(15);});if(pred())return;}throw Error('Timeout '+label);}
async function click(e){assert(e,'Missing element');assert(!e.disabled,'Element disabled '+e.textContent);await act(async()=>{e.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));await delay(0);});}
async function change(e,value){assert(e);const proto=e.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:e.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new w.Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));await delay(0);});}
const button=(text,scope=doc)=>[...scope.querySelectorAll('button')].find(e=>e.textContent.trim()===text),nav=async page=>{await click([...doc.querySelectorAll('.nav-item')].find(e=>e.textContent.includes(page)));};
const rawSection=()=>doc.querySelector('[aria-label="会议 Raw 登记"]'),rawConfirm=()=>[...rawSection().querySelectorAll('input[type=checkbox]')].find(e=>e.parentElement.textContent.includes('imported_minutes'));
async function prepare(title){const c=await req('/api/meeting-catalog');let m=await req('/api/meetings','POST',{requestId:randomUUID(),title,meeting_date:'2026-10-12',meeting_type:c.types[0].id,confidentiality:'Public'},201);m=await req('/api/meetings/'+m.meeting_id+'/policy','PATCH',{baseRevision:m.revision,storage_mode:'local_archive',raw_transfer_authorized:true,confirm_raw_transfer:true});return req('/api/meetings/'+m.meeting_id+'/minutes/import','POST',{baseRevision:m.revision,requestId:randomUUID(),text:'# '+title+' original'},201);}
async function unmount(){if(root){await act(async()=>root.unmount());root=null;}}
async function mount(m){await unmount();w.history.replaceState({},'','/?meeting='+m.meeting_id);root=createRoot(doc.getElementById('root'));await act(async()=>root.render(createElement(App)));await tick(()=>doc.querySelector('.stat-card strong')&&!doc.querySelector('.loading-note'),'initial App data');await nav('会议档案');await tick(()=>!!rawSection()&&doc.querySelector('.meeting-detail h2')?.textContent===m.title,'meeting opened');}
async function register(m){await click(rawConfirm());await click(button('登记 Raw',rawSection()));await tick(()=>rawSection().textContent.includes('已关联')||rawSection().querySelector('[role=alert]'),'registration completed');const current=await req('/api/meetings/'+m.meeting_id);assert.equal(current.raw_links.length,1);return current.raw_links[0].raw_id;}
async function openLink(id){const article=[...rawSection().querySelectorAll('article')].find(e=>e.textContent.includes(id));assert(article);await click(button('查看 Raw',article));await tick(()=>!!doc.querySelector('.raw-page')&&doc.querySelector('.raw-detail')?.textContent.includes(id),'linked Raw detail '+id);}
async function test(id,fn){const actual={};try{await fn(actual);checks.push({id,result:'PASS',actual});}catch(e){checks.push({id,result:'FAIL',actual,error:e.message});}finally{intercept=null;await unmount();}}
try{
 await test('AJ01-ordinary-job-settle-refresh-preserves-current-Raw-selection',async a=>{
  let release,seen=false;const waiting=new Promise(r=>release=r);
  h.setReply(async()=>{seen=true;await waiting;return{httpStatus:500,message:'Controlled ordinary fake failure'};});
  const raw=title=>req('/api/raw','POST',{title,sourceType:'other',sourceName:'isolated ordinary source',tags:[],body:'# '+title},201);
  const older=await raw('AJ01用户选中的旧Raw');await delay(15);const newer=await raw('AJ01初始较新Raw');
  const job=await req('/api/raw/'+newer.id+'/extract','POST',{},202);
  try{
   await tick(()=>seen,'ordinary fake request held');
   w.history.replaceState({},'','/');root=createRoot(doc.getElementById('root'));await act(async()=>root.render(createElement(App)));
   await tick(()=>doc.querySelector('.stat-card strong')?.textContent==='2'&&!doc.querySelector('.loading-note'),'App loaded ordinary running job');
   await nav('Raw 原始资料');await tick(()=>doc.querySelector('.raw-detail')?.textContent.includes(newer.id),'initial newest selection');
   await act(async()=>{await delay(80);});
   await click([...doc.querySelectorAll('button.raw-list-item')].find(e=>e.textContent.includes(older.title)));
   await tick(()=>doc.querySelector('.raw-detail')?.textContent.includes(older.id),'user selected older Raw');
   const count=requests.filter(e=>e.path==='/api/raw'&&e.method==='GET').length;release();
   await tick(()=>requests.filter(e=>e.path==='/api/raw'&&e.method==='GET').length>count,'actual job poll completed and background Raw refresh started');
   await act(async()=>{await delay(180);});
   a.userSelected=older.id;a.initialRaw=newer.id;a.jobId=job.jobId;a.actualJob=(await req('/api/extraction-jobs/'+job.jobId)).status;a.shownDetail=doc.querySelector('.raw-detail')?.textContent??null;
   assert.equal(a.actualJob,'failed');assert(doc.querySelector('.raw-detail')?.textContent.includes(older.id),'Job settle refresh must not restore stale selectedRawId from its old closure');
  }finally{release();}
 });
}finally{await unmount();globalThis.fetch=originalFetch;w.close();await h.close();const result={at:new Date().toISOString(),kind:'Actual App + real isolated HTTP + ordinary fake Provider job/poll',dataRoot:h.dataRoot,durationMs:Date.now()-started,checks,summary:{pass:checks.filter(c=>c.result==='PASS').length,fail:checks.filter(c=>c.result==='FAIL').length},requests,providerCalls:h.requests.length,providerMeaning:'One explicit ordinary Raw fake job only; no Meeting input or external Provider',servicesClosed:h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null)};await fs.writeFile('docs/reports/M05-20261012-app-job-component.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary));if(result.summary.fail)process.exitCode=1;}
