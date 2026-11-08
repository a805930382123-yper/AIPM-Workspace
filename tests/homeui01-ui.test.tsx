import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});const w=dom.window;
for(const [name,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
w.HTMLElement.prototype.scrollIntoView=()=>{};
const {act,createElement}=await import('react');const {createRoot}=await import('react-dom/client');const {HomePage}=await import('../app/pages/HomePage.tsx');
const stats={rawCount:0,wikiCount:0,thisWeekNewCount:0,pendingConfirmationCount:1,openAuditCount:1,promptCount:0,weekStartsOn:''};
const item=(kind:string,title:string)=>({kind,id:kind,title,problem:'待处理',result:'已记录',action:'打开',updatedAt:'2026-10-01',priority:1,target:{},versionToken:'v1'});
const tick=()=>new Promise(r=>setTimeout(r,0));const button=(name:string)=>[...w.document.querySelectorAll('button')].find(x=>x.textContent?.includes(name))!;
test('首次失败停止加载，刷新恢复；Audit 入口解除审核筛选且底部入口不重复',async()=>{
 let fail=true;const old=globalThis.fetch;globalThis.fetch=async input=>{if(String(input)==='/api/wiki')return new Response(JSON.stringify({items:[]}));if(fail)throw Error('offline');return new Response(JSON.stringify({items:[item('draft','草稿任务'),item('audit','纠错任务')],sources:{draft:{status:'ok'},audit:{status:'ok'}}}));};
 const root=createRoot(w.document.getElementById('root')!);const noop=()=>{};
 try{await act(async()=>{root.render(createElement(HomePage,{stats,items:[],onOpenRaw:noop,onOpenWiki:noop,onOpenPrompt:noop,onImport:noop,onCreateWiki:noop,onCreatePrompt:noop,onGeneratePrompt:noop,onLint:noop}));await tick();});
  assert.match(w.document.body.textContent!,/行动事项读取失败/);assert.doesNotMatch(w.document.body.textContent!,/正在读取事项/);
  fail=false;await act(async()=>{button('刷新').click();await tick();});assert.match(w.document.body.textContent!,/纠错任务/);
  await act(async()=>{button('审核草稿').click();await tick();});assert.doesNotMatch(w.document.body.textContent!,/纠错任务/);
  await act(async()=>{button('Open Audit').click();await tick();});assert.match(w.document.body.textContent!,/纠错任务/);
  const tools=w.document.querySelector('.home-quick-actions')!;assert.doesNotMatch(tools.textContent!,/仅保存 Raw|生成 Prompt/);assert.match(tools.textContent!,/从 Raw 生成 Wiki 草稿/);
 }finally{await act(async()=>root.unmount());globalThis.fetch=old;dom.window.close();}
});
