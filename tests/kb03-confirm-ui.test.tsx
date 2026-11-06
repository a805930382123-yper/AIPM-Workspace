import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {confirmFixture} from './support/kb03-confirm-fixture.ts';
import {storageHttp} from './support/kb02-storage-http.ts';
import {renderStructuredNote} from '../services/wiki/structured-note.ts';
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});w.HTMLElement.prototype.scrollIntoView=()=>{};
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{DraftReviewPage}=await import('../app/pages/DraftReviewPage'),{FormalNoteReader}=await import('../app/components/FormalNoteReader');
const nativeFetch=globalThis.fetch,buttons=(label:string)=>[...w.document.querySelectorAll('button')].filter(b=>b.textContent?.trim()===label);
async function tick(check:()=>boolean,label:string){for(let i=0;i<500;i++){await act(async()=>{await new Promise(r=>setTimeout(r,15));});if(check())return;}assert.fail(label+' '+w.document.body.textContent?.slice(0,1000));}
async function click(b:HTMLButtonElement|undefined){assert(b);assert(!b.disabled);await act(async()=>b.click());}
test('KB03 Source-only outcome uses one explicit confirmation and writes the deep note',async()=>{
 const f=await confirmFixture(),h=await storageHttp(f as any,f.runner,{knowledge:true}),root=createRoot(w.document.getElementById('root')!);
 const requests:Array<{url:string;body:any}>=[];
 globalThis.fetch=(url,init)=>{if(init?.method==='POST')requests.push({url:String(url),body:JSON.parse(String(init.body))});return nativeFetch(String(url).startsWith('/api/')?h.base+url:url,init);};
 let done=0;
 try{
  await act(async()=>root.render(createElement(DraftReviewPage,{draftId:f.d.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{done++;}})));
  await tick(()=>!!buttons('仅确认来源笔记入库')[0],'Source-only result ready');
  assert.equal(w.document.querySelector('.note-approval'),null);
  assert.equal((await f.wiki.allRecords()).length,0);
  assert.match(w.document.querySelector('[aria-label="整体确认入库"]')!.textContent!,/本次主题 0 项/);
  await click(buttons('仅确认来源笔记入库')[0]);
  await tick(()=>done===1,'formal completion');
  assert(w.document.querySelector('.subheading')!.textContent!.includes('已确认'));
  assert(w.document.querySelector('[aria-label="已入库成果"]'));
  assert.equal(buttons('仅确认来源笔记入库').length,0);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/drafts/'+f.d.id+'/confirm');
  assert.deepEqual(requests[0].body.selectedPageIds,[]);
  assert.equal(requests[0].body.outcomeDigest,f.drafts.outcomeDigest(f.d));
  const wiki=await f.wiki.allRecords();
  assert.equal(wiki.length,1);
  assert.equal(wiki[0].type,'source');
  assert.match(wiki[0].body,/深度整理笔记/);
  assert.equal(f.requests.length,6);
 }finally{await act(async()=>root.unmount());globalThis.fetch=nativeFetch;await h.close();await f.clean();}
});
test('KB03 formal reading DOM grid preserves pipes/newlines/HTML/links as literal text, falls back on invalid table',async()=>{
 const f=await confirmFixture(),root=createRoot(w.document.getElementById('root')!);try{const note=structuredClone(f.d.structuredNote!);const table=note.sections[0].blocks.find(b=>b.type==='table')!;assert(table.type==='table');const text='a | b\n<script>bad()</script> [链接](https://example.com) [[未选卡]]';table.rows[0].cells[0]=text;await act(async()=>root.render(createElement(FormalNoteReader,{body:'## 摘要\n\n原摘要\n\n## 深度整理笔记\n\n'+renderStructuredNote(note,true)})));assert(w.document.querySelector('table thead'));assert(w.document.querySelector('table tbody'));assert.equal(w.document.querySelector('tbody td')!.textContent,text);assert.equal(w.document.querySelectorAll('script,a,img').length,0);
  await act(async()=>root.render(createElement(FormalNoteReader,{body:'## 深度整理笔记\n| a | b |\n| --- | --- |\n| wrong |'})));assert(!w.document.querySelector('table'));assert(w.document.body.textContent!.includes('wrong'));
 }finally{await act(async()=>root.unmount());await f.clean();}
});
