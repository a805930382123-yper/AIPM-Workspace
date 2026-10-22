import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createHarness,request,expect,rawInput,delay } from './kb02-20261015-standards-harness.mjs';
const prefix='docs/reports/PA01-SOL-20261016-builder-',started=Date.now(),rows=[];
const h=await createHarness(()=>({title:'虚构综合',category:'other',agreement:[],conflicts:[],inferences:[],openQuestions:[],suggestedAdditions:[]}));
let root,originalFetch=globalThis.fetch;const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window,doc=w.document;
for(const [name,value]of Object.entries({window:w,document:doc,location:w.location,history:w.history,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLSelectElement:w.HTMLSelectElement,HTMLTextAreaElement:w.HTMLTextAreaElement,Event:w.Event,CustomEvent:w.CustomEvent,MouseEvent:w.MouseEvent,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{RecoveryNotice}=await import('../../app/components/RecoveryNotice.tsx');
async function test(id,fn){try{rows.push({id,result:'PASS',evidence:await fn()});}catch(e){rows.push({id,result:'FAIL',error:e.stack});}console.log(id+': '+rows.at(-1).result);}
async function mount(){if(root)await act(async()=>root.unmount());root=createRoot(doc.querySelector('#root'));await act(async()=>{root.render(createElement(RecoveryNotice));await delay(0);});}
async function tick(fn){for(let i=0;i<200;i++){await act(async()=>{await delay(20);});if(fn())return;}throw Error('UI wait timeout: '+doc.body.textContent);}
async function refresh(){await act(async()=>{doc.querySelector('button').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await delay(0);});}
let out;try{
 const s=await h.start();globalThis.fetch=async(url,init)=>originalFetch(String(url).startsWith('/api/')?s.base+url:url,init);
 const a=await expect(s,'/api/raw','POST',rawInput('虚构甲','资料甲'),201),b=await expect(s,'/api/raw','POST',rawInput('虚构乙','资料乙'),201);
 const healthy=await expect(s,'/api/knowledge/syntheses','POST',{rawIds:[a.id,b.id]},201),dir=path.join(h.dataRoot,'drafts','knowledge-workflows');
 await test('HTTP-R01-real-get-list-scan-patch-confirm-reject-deep-shapes',async()=>{
  const variants=[['evidence-object',v=>v.evidence={}],['evidence-element',v=>v.evidence=[{}]],['sourceList-element',v=>v.sections.sourceList=[{}]],['kind-array',v=>v.kind=['synthesis']],['status-array',v=>v.status=['pending_confirmation']],['update-target-missing',v=>v.kind='update']];
  for(const [name,mutate]of variants){const bad=structuredClone(healthy);bad.id=randomUUID();mutate(bad);const file=path.join(dir,bad.id+'.json'),bytes=JSON.stringify(bad);await fs.writeFile(file,bytes);
   const get=await request(s,'/api/knowledge/workflows/'+bad.id),list=await request(s,'/api/knowledge/workflows'),scan=await request(s,'/api/recovery-issues'),patch=await request(s,'/api/knowledge/workflows/'+bad.id,'PATCH',{baseRevision:1,sections:healthy.sections,title:'编辑'}),confirm=await request(s,'/api/knowledge/workflows/'+bad.id+'/confirm','POST',{baseRevision:1,idempotencyKey:randomUUID()});
   for(const r of [get,patch,confirm]){assert.equal(r.status,500,name);assert.equal(r.json.error.code,'STORAGE_CORRUPT');assert.equal(r.json.error.details.category,'recovery');assert.equal(r.json.error.details.nextAction,'inspect_or_restore');}
   assert.equal(list.status,200);assert(list.json.items.some(x=>x.id===healthy.id));assert(!list.json.items.some(x=>x.id===bad.id));assert(scan.json.items.some(x=>x.kind==='workflows'&&x.reason==='shape'));assert.equal(await fs.readFile(file,'utf8'),bytes);await fs.writeFile(file,JSON.stringify({...structuredClone(healthy),id:bad.id}));assert.equal((await expect(s,'/api/recovery-issues')).totalIssues,0);assert.equal((await expect(s,'/api/knowledge/workflows/'+bad.id)).id,bad.id);assert((await expect(s,'/api/knowledge/workflows')).items.some(x=>x.id===bad.id));await fs.rm(file);
  }
  assert.equal((await request(s,'/api/knowledge/workflows/'+randomUUID())).status,404);assert.equal(h.requests.length,1);return {variants:variants.length,actualHttp:true,healthyNeighbor:true,corruptBytesUnchanged:true,repairedSameIdAcceptedAndIssueCleared:true,providerCallsDuringChecks:0};
 });
 const prompts=path.join(h.dataRoot,'drafts','prompts');await fs.mkdir(prompts,{recursive:true});const files=[];
 for(const count of [499,500,501,1201])await test('HTTP+COMPONENT-R02-'+count,async()=>{
  while(files.length<count){const file=path.join(prompts,randomUUID()+'.json');files.push(file);await fs.writeFile(file,'{broken');}
  const scan=await expect(s,'/api/recovery-issues');assert.equal(scan.totalIssues,count);assert.equal(scan.items.length,Math.min(count,500));assert.equal(scan.scanned,true);assert.equal(scan.partial,false);assert.equal(scan.truncated,count>500);assert.equal(scan.overflow,count>500);assert.equal(scan.hiddenIssues,Math.max(0,count-500));assert.equal(scan.scannedFiles,count+1);assert(JSON.stringify(scan).length<100000);
  await mount();await tick(()=>doc.body.textContent.includes('发现 '+count+' 个'));assert(!doc.body.textContent.includes('至少'));assert.equal(doc.body.textContent.includes('问题摘要已截断'),count>500);if(count>500)assert(doc.body.textContent.includes('另有 '+(count-500)+' 项'));assert.equal(doc.querySelectorAll('p').length,count>500?7:6);assert(!doc.body.textContent.includes(h.dataRoot));assert(!doc.body.textContent.includes('{broken'));
  const again=await expect(s,'/api/recovery-issues');assert.equal(again.totalIssues,count);assert.deepEqual(again.items,scan.items);return {returned:scan.items.length,total:scan.totalIssues,hidden:scan.hiddenIssues,truncated:scan.truncated,partial:scan.partial,componentText:doc.body.textContent,responseBytes:Buffer.byteLength(JSON.stringify(scan))};
 });
 await test('HTTP+COMPONENT-R02-hidden-item-repair-removal-refresh',async()=>{
  const scan=await expect(s,'/api/recovery-issues'),visible=new Set(scan.items.map(x=>x.id)),hidden=files.find(file=>!visible.has(createHash('sha256').update(path.relative(h.dataRoot,file)).digest('hex').slice(0,16)));assert(hidden);await fs.rm(hidden);await refresh();await tick(()=>doc.body.textContent.includes('发现 1200 个'));assert(doc.body.textContent.includes('另有 700 项'));const next=await expect(s,'/api/recovery-issues');assert.equal(next.totalIssues,1200);assert.equal(next.hiddenIssues,700);
  // Replacing the remaining malformed records with missing files clears them only after rescan.
  for(const file of files)await fs.rm(file,{force:true});await refresh();await tick(()=>!doc.querySelector('aside'));assert.equal((await expect(s,'/api/recovery-issues')).totalIssues,0);return {hiddenIssueTracked:true,afterHiddenRemoval:1200,afterAllRemoved:0,uiClearsOnRefresh:true};
 });
 await test('HTTP+COMPONENT-R02-partial-scan-is-distinct-from-truncation',async()=>{
  const file=path.join(prompts,randomUUID()+'.json');await fs.writeFile(file,' '.repeat(2*1024*1024+1));const scan=await expect(s,'/api/recovery-issues');assert.equal(scan.partial,true);assert.equal(scan.scanned,false);assert.equal(scan.truncated,false);assert.equal(scan.overflow,true);await mount();await tick(()=>doc.body.textContent.includes('至少'));assert(doc.body.textContent.includes('数量仅为当前已知下限'));assert(!doc.body.textContent.includes('问题摘要已截断'));await fs.rm(file);await refresh();await tick(()=>!doc.querySelector('aside'));return {partial:scan.partial,totalKnown:scan.totalIssues,truncated:scan.truncated,uiLowerBound:true};
 });
 out={at:new Date().toISOString(),root:h.dataRoot,rows,externalCalls:0,localFakeCalls:h.requests.length,durationMs:Date.now()-started,summary:{pass:rows.filter(x=>x.result==='PASS').length,fail:rows.filter(x=>x.result==='FAIL').length}};
}finally{if(root)await act(async()=>root.unmount());globalThis.fetch=originalFetch;await h.close();dom.window.close();out??={rows};out.closed=h.services.every(x=>x.child.exitCode!==null||x.child.signalCode!==null);await fs.writeFile(prefix+'r01-r02-http-component.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out.summary));if(out.rows.some(x=>x.result==='FAIL'))process.exitCode=1;}
