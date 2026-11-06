import {approveDraft} from './support/human-review.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { JSDOM } from 'jsdom';
import { r13Fixture } from './support/r13-merge-fixture.ts';
import { registerB04Routes } from '../server/llm-api.ts';
import { LLMService } from '../services/llm/service.ts';
import { ExtractionJobStore, ExtractionRunner } from '../services/llm/jobs.ts';

const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{DraftReviewPage}=await import('../app/pages/DraftReviewPage.tsx');
const nativeFetch=globalThis.fetch;
const button=(label:string)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!;
async function wait(check:()=>boolean,label:string){for(let i=0;i<300;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});if(check())return;}assert.fail(label+': '+w.document.body.textContent?.slice(0,500));}
async function click(target:HTMLButtonElement|HTMLInputElement){assert(target);assert.equal(target.disabled,false);await act(async()=>{target.click();});}

test('R13 M03/05 React + actual HTTP merges same/cross fields, saves group edits, reloads and confirms the selected outcome',async()=>{
  const f=await r13Fixture(),llm=new LLMService('rules'),jobs=new ExtractionJobStore(f.root);await jobs.initialize();
  const runner=new ExtractionRunner({root:f.root,llm,jobs,drafts:f.drafts,rawStates:f.states,rawStore:f.raws,rulesDir:'rules',provider:()=>undefined,draftRules:async()=>f.rules});
  const app=express();app.use(express.json({limit:'3mb'}));app.get('/api/raw/:id',async(req,res)=>res.json(await f.raws.get(req.params.id)));app.get('/api/wiki/schema',async(_req,res)=>res.json(await f.wiki.schema()));
  registerB04Routes(app,{root:f.root,rulesDir:'rules',provider:()=>undefined,llm,runner,jobs,drafts:f.drafts,commits:f.commits,rawStates:f.states,rawStore:f.raws,wikiStore:f.wiki});
  app.get('/api/knowledge/drafts/:id/pages/:page/duplicates',(_req,res)=>res.json({candidates:[]}));
  app.use(((error:any,_req:any,res:any,_next:any)=>res.status(error.status??500).json({error:{code:error.code,message:error.message,details:error.details}})) as express.ErrorRequestHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`;
  globalThis.fetch=(input,init)=>nativeFetch(String(input).startsWith('/api/')?base+input:input,init);
  let root:ReturnType<typeof createRoot>|undefined,committed=0;
  const mount=async()=>{root=createRoot(w.document.getElementById('root')!);await act(async()=>root!.render(createElement(DraftReviewPage,{draftId:f.draft.id,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{committed++;}})));await wait(()=>!!button('保存草稿'),'loaded');};
  const merge=async(indices:number[])=>{const boxes=[...w.document.querySelectorAll<HTMLInputElement>('.draft-card-head label')].filter(label=>label.textContent?.includes('合并')).map(label=>label.querySelector('input')!);for(const index of indices)await click(boxes[index]);await click(button(`合并所选（${indices.length}）`));};
  try{
    await approveDraft(f.drafts,f.draft.id,f.raw.body);
    await mount();
    await merge([0,1]);await wait(()=>w.document.querySelectorAll('.draft-card').length===2,'same type merged');assert.equal(w.document.querySelectorAll('[data-merged-group]').length,1);assert.equal((await f.drafts.get(f.draft.id))!.humanReview!.approvals.length,0);
    // Merge order follows the selected target: current merged Concept first, remaining Process second.
    const cards=[...w.document.querySelectorAll<HTMLElement>('.draft-card')],conceptIndex=cards.findIndex(card=>card.textContent?.includes('合并前字段组：补货概念2'));
    await merge([conceptIndex,1-conceptIndex]);await wait(()=>w.document.querySelectorAll('.draft-card').length===1,'cross type merged');assert.equal(w.document.querySelectorAll('[data-merged-group]').length,2);assert.match(w.document.body.textContent!,/business_process/);
    const input=w.document.querySelector<HTMLTextAreaElement>('[data-merged-group] [data-template-field="definition"] label.field:last-child textarea')!;assert(input);
    await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'React合并组人工说明');input.dispatchEvent(new w.Event('input',{bubbles:true}));});
    await click(button('保存草稿'));await wait(()=>button('保存草稿')?.disabled===true&&w.document.querySelector('.raw-outcome')?.getAttribute('aria-busy')==='false','group save');await act(async()=>root!.unmount());root=undefined;await mount();assert([...w.document.querySelectorAll('textarea')].some(node=>node.value==='React合并组人工说明'));
    const confirm=()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent?.startsWith('确认所选成果入库'))!;
    assert(confirm().disabled);
    const pick=w.document.querySelector<HTMLInputElement>('input[aria-label^="选择入库 "]')!;
    await click(pick);
    await wait(()=>!confirm().disabled,'selected outcome ready');
    assert.equal((await f.drafts.get(f.draft.id))!.humanReview!.approvals.length,0);
    assert.equal((await f.wiki.allRecords()).length,0);
    await click(confirm());
    await wait(()=>committed===1,'explicit final commit');
    const records=await f.wiki.allRecords();assert.equal(records.length,2);assert(records.every(record=>record.body.includes('React合并组人工说明')));assert.equal((await f.drafts.get(f.draft.id))!.status,'confirmed');
  }finally{if(root)await act(async()=>root!.unmount());globalThis.fetch=nativeFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));await f.clean();}
});
