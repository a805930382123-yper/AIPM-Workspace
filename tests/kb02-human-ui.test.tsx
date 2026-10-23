import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {storageFixture} from './support/kb02-storage-fixture.ts';
import {storageHttp} from './support/kb02-storage-http.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../services/wiki/knowledge-workflows.ts';

const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{DraftReviewPage}=await import('../app/pages/DraftReviewPage.tsx'),{KnowledgeWorkflowPage}=await import('../app/pages/KnowledgeWorkflowPage.tsx');
const nativeFetch=globalThis.fetch;
const buttons=(label:string)=>[...w.document.querySelectorAll('button')].filter(b=>b.textContent?.trim()===label);
async function tick(check:()=>boolean,label:string){const deadline=performance.now()+6000;while(performance.now()<deadline){await act(async()=>{await new Promise(r=>setTimeout(r,15));});if(check())return;}assert.fail('Human UI timeout: '+label+' '+w.document.body.textContent?.slice(0,500));}
async function click(button:HTMLButtonElement|undefined){assert(button);assert(!button.disabled);await act(async()=>{button.click();await new Promise(r=>setTimeout(r,0));});}
async function change(element:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{const proto=element instanceof w.HTMLSelectElement?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(element,value);element.dispatchEvent(new w.Event('change',{bubbles:true}));if(element instanceof w.HTMLInputElement)element.dispatchEvent(new w.Event('input',{bubbles:true}));});}

test('HUMAN React + real HTTP saves selection, resolves units, reviews every page, invalidates edits, refreshes then explicitly commits',async()=>{
 const f=await storageFixture();f.succeed();const original=f.provider.complete;f.provider.complete=async request=>{const response=await original(request);if(request.user.includes('请对下列全部已验证事实规划知识页')){const p=JSON.parse(response.text),page=p.pages[0];p.pages=[{...page,title:'目标门店',factUnitIds:page.factUnitIds.slice(0,1)},{...page,title:'铺货率',factUnitIds:page.factUnitIds.slice(1)}];return {...response,text:JSON.stringify(p)};}return response;};
 const job=await f.wait((await f.start()).job.id),h=await storageHttp(f,f.runner,{knowledge:true});let root:ReturnType<typeof createRoot>|undefined,committed=0;
 globalThis.fetch=(url,init)=>nativeFetch(String(url).startsWith('/api/')?h.base+url:url,init);
 try{const mount=async()=>{root=createRoot(w.document.getElementById('root')!);await act(async()=>root!.render(createElement(DraftReviewPage,{draftId:job.draftId!,onBack:()=>{},onOpenRaw:()=>{},onCommitted:async()=>{committed++;}})));await tick(()=>buttons('确认本页主题与归属').length===2,'two page review');};
  await mount();assert(w.document.body.textContent!.includes(f.raw.body));assert([...w.document.querySelectorAll('.draft-line textarea')].some(e=>(e as HTMLTextAreaElement).readOnly));
  const confirm=()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent?.startsWith('确认写入 Wiki'))!;assert(confirm().disabled);
  const checks=w.document.querySelectorAll<HTMLInputElement>('.draft-card-head .draft-select input');await act(async()=>{checks[0].click();});assert(confirm().disabled);await click(buttons('保存草稿')[0]);await tick(()=>!buttons('确认本页主题与归属')[0].disabled,'saved selection');
  let d=(await f.drafts.get(job.draftId!))!,unit=d.humanReview!.units[0];let select=w.document.querySelector<HTMLSelectElement>(`select[aria-label="归属 ${unit.id}"]`)!;
  await change(select,'');await tick(()=>w.document.body.textContent!.includes('未解决 1 项'),'unresolved');assert(confirm().disabled);
  select=w.document.querySelector<HTMLSelectElement>(`select[aria-label="归属 ${unit.id}"]`)!;await change(select,d.pages[0].pageId);await tick(()=>w.document.body.textContent!.includes('未解决 0 项'),'resolved');
  for(let i=0;i<2;i++){await click(buttons('确认本页主题与归属')[i]);await tick(()=>buttons('确认本页主题与归属').every(b=>!b.disabled),'page saved');}
  await tick(()=>!confirm().disabled,'all reviewed');
  const title=w.document.querySelector<HTMLInputElement>('.draft-title')!;await change(title,'人工确认的新主题');await tick(()=>confirm().disabled,'unsaved editing blocks');await click(buttons('保存草稿')[0]);await tick(()=>w.document.body.textContent!.includes('已审 0/2 页')&&buttons('确认本页主题与归属').every(b=>!b.disabled),'all invalidated and save settled');
  for(let i=0;i<2;i++){await click(buttons('确认本页主题与归属')[i]);await tick(()=>buttons('确认本页主题与归属').every(b=>!b.disabled),'re-reviewed');}
  await act(async()=>root!.unmount());root=undefined;await mount();await tick(()=>!confirm().disabled,'refresh retains approvals');await click(confirm());await tick(()=>committed===1,'formal explicit commit');
  d=(await f.drafts.get(job.draftId!))!;assert.equal(d.status,'confirmed');assert.equal(f.requests.length,2);assert.equal((await f.rawStore.get(f.raw.id))!.body,f.raw.body);
 }finally{if(root)await act(async()=>root!.unmount());globalThis.fetch=nativeFetch;await h.close();await f.clean();}
});

test('HUMAN synthesis React + real HTTP shows immutable proposals, unresolved blocks, corrected content needs new single-page review',async()=>{
 const f=await storageFixture(),h=await storageHttp(f,f.runner,{knowledge:true});let root:ReturnType<typeof createRoot>|undefined,done=0;
 globalThis.fetch=(url,init)=>nativeFetch(String(url).startsWith('/api/')?h.base+url:url,init);
 try{const second=await f.rawStore.create({title:'第二来源',sourceType:'report',sourceName:'虚构',tags:[],body:'目标门店120家。'}),wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const service=new KnowledgeWorkflowStore(f.root,wiki,f.rawStore);await service.initialize();const flow=await service.createSynthesis({rawIds:[f.raw.id,second.id],provider:{name:'fake',model:'ui',complete:async()=>({text:JSON.stringify({title:'综合预览',category:'metric',suggestedAdditions:[],conflicts:[],agreement:[],inferences:['待人工核对的推断'],openQuestions:[]}),bytes:1,finishReason:'stop'})}});
  root=createRoot(w.document.getElementById('root')!);await act(async()=>root!.render(createElement(KnowledgeWorkflowPage,{workflowId:flow.id,onBack:()=>{},onDone:async()=>{done++;}})));await tick(()=>buttons('确认本页主题与完整归属').length===1,'workflow review');
  assert(w.document.body.textContent!.includes('待人工核对的推断'));const select=w.document.querySelector<HTMLSelectElement>('select[aria-label^="归属 "]')!;await change(select,'');await tick(()=>w.document.body.textContent!.includes('未解决 1 项'),'workflow unresolved');await click(buttons('确认写入')[0]);assert.equal(done,0);assert.match(w.document.body.textContent!,/解决所有未解决项/);
  await change(w.document.querySelector<HTMLSelectElement>('select[aria-label^="归属 "]')!,flow.id);await tick(()=>w.document.body.textContent!.includes('未解决 0 项'),'workflow resolved');await click(buttons('确认本页主题与完整归属')[0]);await tick(()=>w.document.body.textContent!.includes('本页已审查'),'single review');await click(buttons('确认写入')[0]);await tick(()=>done===1,'workflow formal commit');assert.equal((await service.get(flow.id))!.status,'confirmed');
 }finally{if(root)await act(async()=>root!.unmount());globalThis.fetch=nativeFetch;await h.close();await f.clean();}
});
