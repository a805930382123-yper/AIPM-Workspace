import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import type {Raw,RawProcessingState} from '../app/api';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true}),w=dom.window;
for(const [name,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLSelectElement:w.HTMLSelectElement,HTMLInputElement:w.HTMLInputElement,Event:w.Event,MouseEvent:w.MouseEvent,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act}=await import('react'),{createRoot}=await import('react-dom/client'),{RawPage}=await import('../app/pages/RawPage.tsx');
const raw=(id:string):Raw=>({id,status:'unprocessed',title:id,body:'合成原文',sourceType:'report',sourceName:'合成',tags:[],bodySha256:'a'.repeat(64),importedAt:'2026-11-01T00:00:00Z'});
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const payload=(rawId:string,title:string)=>({id:`draft${rawId}`,rawId,status:'pending_confirmation',maintenance:{changes:[{action:'update',decision:'defer',candidate:{title}}]}});
const render=async(root:ReturnType<typeof createRoot>,selectedId:string,processing:Record<string,RawProcessingState>)=>{await act(async()=>{root.render(<RawPage items={[raw('A'),raw('B')]} selectedId={selectedId} onSelected={()=>{}} onOpenImport={()=>{}} onCommitted={async()=>{}} openImport={false} onCloseImport={()=>{}} onDeleted={async()=>{}} processing={processing} job={null} onJobStarted={()=>{}} onOpenDraft={()=>{}} onRefresh={async()=>{}}/>);});};
const tick=async()=>act(async()=>{await new Promise(r=>setTimeout(r,10));});

test('LW01 Raw actual draft topics ignore a late response from a previously selected Raw',async()=>{
  const container=w.document.createElement('div');w.document.body.append(container);const root=createRoot(container);let release!:(value:Response)=>void;
  globalThis.fetch=async input=>{const url=String(input);if(url==='/api/drafts/draftA')return new Promise<Response>(r=>release=r);if(url==='/api/drafts/draftB')return reply(payload('B','B真实主题'));return reply({items:[]});};
  const state=(rawId:string,draftId:string):RawProcessingState=>({rawId,draftId,status:'pending_confirmation',updatedAt:'now'}),states={A:state('A','draftA'),B:state('B','draftB')};
  try{await render(root,'A',states);await render(root,'B',states);await tick();assert(container.textContent!.includes('B真实主题'));await act(async()=>release(reply(payload('A','A迟到主题'))));await tick();assert(!container.textContent!.includes('A迟到主题'));assert(container.textContent!.includes('B真实主题'));}finally{await act(async()=>root.unmount());container.remove();}
});

test('LW01 Raw uses actual formal titles and reports failed impact reads instead of saying there are none',async()=>{
  const container=w.document.createElement('div');w.document.body.append(container);const root=createRoot(container);let fail=false;
  globalThis.fetch=async input=>{const url=String(input);if(url==='/api/wiki/wikiA')return fail?reply({error:{message:'合成读取失败'}},500):reply({title:'真实正式主题',type:'metric'});return reply({items:[]});};
  try{await render(root,'A',{A:{rawId:'A',status:'generated',updatedAt:'1',generatedWikiIds:['wikiA']}});await tick();assert(container.textContent!.includes('真实正式主题'));fail=true;await render(root,'A',{A:{rawId:'A',status:'generated',updatedAt:'2',generatedWikiIds:['wikiA']}});await tick();assert(container.textContent!.includes('受影响主题读取失败'));assert(!container.textContent!.includes('真实正式主题'));}finally{await act(async()=>root.unmount());container.remove();}
});
