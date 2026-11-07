import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

test('状态读取失败可恢复轮询，首页焦点跨日才重新 ensure',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5173/',pretendToBeVisual:true});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true});
 let day='2026-11-07',ensures=0,gets=0,fail=true,ready=false;
 const view=()=>({date:day,aiEnabled:false,edition:{schemaVersion:1,date:day,updatedAt:'',sections:{fmcg:{status:ready?'source_only':'running',attempt:1,startedAt:'',sources:[],items:[]}}},fallbacks:{}});
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/ensure')){ensures++;return new Response(JSON.stringify(view()),{status:200});}if(url.endsWith('/today')){gets++;if(fail){fail=false;return new Response('{}',{status:503});}return new Response(JSON.stringify(view()),{status:200});}throw Error('unexpected request '+url+' '+init?.method);};
 const {NewsHome}=await import('../app/pages/NewsPage.tsx');const root=createRoot(document.getElementById('root')!);
 try{await act(async()=>{root.render(React.createElement(NewsHome,{onOpen:()=>{}}));});assert.equal(ensures,1);
 await act(async()=>{await new Promise(r=>setTimeout(r,2150))});assert.match(document.body.textContent! ,/资讯状态读取失败/);
 const button=[...document.querySelectorAll('button')].find(x=>x.textContent==='重新读取状态');assert.ok(button);await act(async()=>{button.click();await new Promise(r=>setTimeout(r,20))});assert.equal(ensures,1);ready=true;
 await act(async()=>{await new Promise(r=>setTimeout(r,2150))});assert.match(document.body.textContent!,/来源摘录可阅读/);const oldGets=gets;
 await act(async()=>{window.dispatchEvent(new Event('focus'));await new Promise(r=>setTimeout(r,20))});assert.equal(ensures,1);assert.ok(gets>oldGets);
 day='2026-11-08';await act(async()=>{window.dispatchEvent(new Event('focus'));await new Promise(r=>setTimeout(r,20))});assert.equal(ensures,2);assert.match(document.body.textContent!,/2026-11-08/);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
