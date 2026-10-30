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
test('KB03 complete DraftReview React + actual HTTP Source-only requires page and explicit note acknowledgment before formal success',async()=>{
 const f=await confirmFixture(),h=await storageHttp(f as any,f.runner,{knowledge:true}),root=createRoot(w.document.getElementById('root')!);globalThis.fetch=(url,init)=>nativeFetch(String(url).startsWith('/api/')?h.base+url:url,init);let done=0;
 try{await act(async()=>root.render(createElement(DraftReviewPage,{draftId:f.d.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{done++;}})));await tick(()=>!!buttons('知识卡片与主题归属审查')[0],'loaded');const confirm=()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent?.startsWith('确认写入 Wiki'))!;assert(confirm().disabled);
  await click(buttons('知识卡片与主题归属审查')[0]);await tick(()=>buttons('确认本页主题与归属').length===2,'two pages');
  for(let i=0;i<2;i++){await click(buttons('确认本页主题与归属')[i]);await tick(()=>!buttons('确认本页主题与归属')[i].disabled,'page reviewed');}assert(confirm().disabled);
  const approve=()=>buttons('确认已核对深度笔记、引用、覆盖与待确认问题')[0];assert(approve().disabled);for(const c of w.document.querySelectorAll<HTMLInputElement>('.note-approval input'))await act(async()=>c.click());await tick(()=>!approve().disabled,'explicit flags');await click(approve());await tick(()=>!confirm().disabled,'note binding');assert(confirm().textContent!.includes('（0）'));await click(buttons('收起知识卡片与人审')[0]);await click(confirm());await tick(()=>done===1,'formal completion');assert(w.document.body.textContent!.includes('正式保存成功'));assert(w.document.querySelector('.subheading')!.textContent!.includes('confirmed'));assert(confirm().disabled);assert(buttons('保存草稿')[0].disabled);assert(!w.document.querySelector('.result-panel')!.closest('[hidden]'));assert.equal((await f.wiki.allRecords()).length,1);assert.equal((await f.wiki.allRecords())[0].type,'source');assert.equal(f.requests.length,5);
 }finally{await act(async()=>root.unmount());globalThis.fetch=nativeFetch;await h.close();await f.clean();}
});
test('KB03 formal reading DOM grid preserves pipes/newlines/HTML/links as literal text, falls back on invalid table',async()=>{
 const f=await confirmFixture(),root=createRoot(w.document.getElementById('root')!);try{const note=structuredClone(f.d.structuredNote!);const table=note.sections[0].blocks.find(b=>b.type==='table')!;assert(table.type==='table');const text='a | b\n<script>bad()</script> [链接](https://example.com) [[未选卡]]';table.rows[0].cells[0]=text;await act(async()=>root.render(createElement(FormalNoteReader,{body:'## 摘要\n\n原摘要\n\n## 深度整理笔记\n\n'+renderStructuredNote(note,true)})));assert(w.document.querySelector('table thead'));assert(w.document.querySelector('table tbody'));assert.equal(w.document.querySelector('tbody td')!.textContent,text);assert.equal(w.document.querySelectorAll('script,a,img').length,0);
  await act(async()=>root.render(createElement(FormalNoteReader,{body:'## 深度整理笔记\n| a | b |\n| --- | --- |\n| wrong |'})));assert(!w.document.querySelector('table'));assert(w.document.body.textContent!.includes('wrong'));
 }finally{await act(async()=>root.unmount());await f.clean();}
});
