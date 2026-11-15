import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {r12Fixture,questionUnitIds,markedText} from './R12-20261026-fixture.ts';
import {approveDraft} from '../support/human-review.ts';
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{DraftReviewPage}=await import('../../app/pages/DraftReviewPage.tsx');
const nativeFetch=globalThis.fetch;
async function tick(check:()=>boolean,label:string){const deadline=performance.now()+6000;while(performance.now()<deadline){await act(async()=>{await new Promise(r=>setTimeout(r,20));});if(check())return;}assert.fail(label);}
test('R12 React explicit checkbox reaches production HTTP, invalidates review and survives remount',async()=>{
 const f=await r12Fixture();let root:ReturnType<typeof createRoot>|undefined;
 let releaseMark:(()=>void)|undefined;const markGate=new Promise<void>(resolve=>releaseMark=resolve);
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/review/questions'))await markGate;return nativeFetch(String(url).startsWith('/api/')?f.h.base+url:url,init);};
 try{
  await approveDraft(f.drafts,f.draft.id,f.raw.body);
  const mount=async()=>{root=createRoot(w.document.getElementById('root')!);await act(async()=>root!.render(createElement(DraftReviewPage,{draftId:f.draft.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{}})));await tick(()=>!!w.document.querySelector(`input[aria-label="同时列入待确认问题 ${questionUnitIds[0]}"]`),'mark control');};
  await mount();const checkbox=()=>w.document.querySelector<HTMLInputElement>(`input[aria-label="同时列入待确认问题 ${questionUnitIds[0]}"]`)!;
  assert.equal(checkbox().checked,false);await act(async()=>checkbox().click());assert.equal(checkbox().disabled,true);releaseMark!();await tick(()=>checkbox().checked&&!checkbox().disabled,'mark saved');
  assert(![...w.document.querySelectorAll('button')].some(b=>b.textContent==='确认本页主题与归属'));assert([...w.document.querySelectorAll('textarea')].some(t=>t.value===markedText));
  const d=(await f.drafts.get(f.draft.id))!;assert.deepEqual(d.humanQuestionUnitIds,[questionUnitIds[0]]);assert.equal(d.humanReview!.approvals.length,0);
  await act(async()=>root!.unmount());root=undefined;await mount();assert.equal(checkbox().checked,true);
  const title=w.document.querySelector<HTMLInputElement>('.draft-title')!;await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value')!.set!.call(title,'人工新标题');title.dispatchEvent(new w.Event('input',{bubbles:true}));});await tick(()=>checkbox().disabled,'dirty disables marker');
  await act(async()=>root!.unmount());root=undefined;d.status='confirmed';await writeFile(f.file,JSON.stringify(d));
  root=createRoot(w.document.getElementById('root')!);await act(async()=>root!.render(createElement(DraftReviewPage,{draftId:f.draft.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{}})));await tick(()=>!!w.document.querySelector('.draft-title'),'confirmed draft loaded');assert.equal(w.document.querySelector('input[aria-label^="同时列入待确认问题 "]'),null);assert.equal(w.document.querySelector<HTMLInputElement>('.draft-title')!.disabled,true);
  assert.equal(f.requests.length,0);
 }finally{releaseMark?.();if(root)await act(async()=>root!.unmount());globalThis.fetch=nativeFetch;await f.close();}
});
