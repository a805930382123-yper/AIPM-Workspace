// Independent deferred network checks for Settings; complements actual browser actions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
const {window}=dom;for(const [k,v]of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,Event:window.Event,MouseEvent:window.MouseEvent,Node:window.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{SettingsPage}=await import('../../app/pages/SettingsPage.tsx');
const tick=()=>new Promise(r=>setTimeout(r,0));
const value=model=>({provider:'openai-compatible',baseUrlHost:'api.example.test',baseUrl:'https://api.example.test/v1',model,keyConfigured:true,keyMask:'••••••••••••',configured:true,source:'local-file',missing:[],configFile:'.env.local',envNames:{},revision:'r-'+model,writeToken:'fixture-token',environmentLocked:false});
const response=body=>({ok:true,status:200,text:async()=>JSON.stringify(body)});
const checks=[];let root;
async function mount(){const reads=[];globalThis.fetch=async input=>{const p=String(input);if(p==='/api/llm/config')return new Promise(resolve=>reads.push(body=>resolve(response(body))));if(p==='/api/demo')return response({version:1,imported:false,items:[],exampleTask:{title:'虚构示例',task:'虚构任务'}});return response({});};root=createRoot(window.document.getElementById('root'));await act(async()=>{root.render(createElement(SettingsPage));await tick();});return reads;}
const field=()=>window.document.querySelector('input[aria-label="模型 ID"]');
const reload=()=>[...window.document.querySelectorAll('button')].find(x=>x.textContent.includes('重新读取'));
async function test(id,fn){try{checks.push({id,result:'PASS',details:await fn()});}catch(e){checks.push({id,result:'FAIL',reason:e.message});}finally{if(root)await act(async()=>{root.unmount();await tick();});root=undefined;}console.log(`${id}: ${checks.at(-1).result}`);}
await test('FCFG05-initial-read-versus-newer-reload',async()=>{
 const reads=await mount();assert.equal(reads.length,1);
 if(reload().disabled){await act(async()=>{reads[0](value('initial'));await tick();});await act(async()=>{reload().click();await tick();});assert.equal(reads.length,2);await act(async()=>{reads[1](value('latest'));await tick();});assert.equal(field().value,'latest');return {initialConcurrentReloadBlocked:true,subsequentReloadWorks:true};}
 await act(async()=>{reload().click();await tick();});assert.equal(reads.length,2);await act(async()=>{reads[1](value('latest'));await tick();});assert.equal(field().value,'latest');await act(async()=>{reads[0](value('older'));await tick();});assert.equal(field().value,'latest');return {olderInitialResponseIgnored:true};
});
await test('FCFG05-reload-versus-user-edit',async()=>{
 const reads=await mount();await act(async()=>{reads[0](value('original'));await tick();});await act(async()=>{reload().click();await tick();});assert.equal(reads.length,2);
 if(field().disabled){await act(async()=>{reads[1](value('server'));await tick();});assert.equal(field().value,'server');return {editingBlockedDuringReload:true};}
 await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field(),'user-unsaved');field().dispatchEvent(new window.Event('input',{bubbles:true}));field().dispatchEvent(new window.Event('change',{bubbles:true}));await tick();});assert.equal(field().value,'user-unsaved');await act(async()=>{reads[1](value('server'));await tick();});assert.equal(field().value,'user-unsaved');return {userEditPreserved:true};
});
await test('R2-02-edit-before-first-response-completes-loading',async()=>{
 const reads=await mount(),wasDisabled=field().disabled;
 if(!wasDisabled)await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field(),'typed-before-first-response');field().dispatchEvent(new window.Event('input',{bubbles:true}));await tick();});
 await act(async()=>{reads[0](value('initial-loaded'));await tick();});
 assert.ok(!window.document.body.textContent.includes('读取中…'));
 assert.ok(!field().disabled);const button=[...window.document.querySelectorAll('button')].find(b=>b.textContent==='保存配置');assert.equal(button.disabled,false);
 assert.equal(field().value,wasDisabled?'initial-loaded':'typed-before-first-response');return {initialEditBlocked:wasDisabled,loadingCompleted:true,saveEnabled:true};
});
await test('R2-02-unmount-read-ignored',async()=>{
 const reads=await mount();await act(async()=>{root.unmount();await tick();});root=undefined;await act(async()=>{reads[0](value('late-unmounted'));await tick();});assert.equal(window.document.getElementById('root').textContent,'');return {lateResponseIgnored:true};
});
const summary={pass:checks.filter(x=>x.result==='PASS').length,fail:checks.filter(x=>x.result==='FAIL').length};await fs.writeFile('docs/reports/CFG01-20261014-component.json',JSON.stringify({scope:'independent Settings jsdom with deferred responses; no real HTTP/provider',checks,summary},null,2));console.log(JSON.stringify(summary));if(summary.fail)process.exitCode=1;


