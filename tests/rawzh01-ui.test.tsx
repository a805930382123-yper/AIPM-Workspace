import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import type {Raw, RawTranslation} from '../app/api';

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {url:'http://localhost/', pretendToBeVisual:true});
const w = dom.window;
for (const [name,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true})) {
  Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
}
const {act,createElement,useState} = await import('react');
const {createRoot} = await import('react-dom/client');
const {RawPage} = await import('../app/pages/RawPage');
const raw:Raw={id:'raw-english',title:'English report',sourceType:'article',sourceName:'fixture',url:'https://fixture.example/report',urlImport:{finalUrl:'https://fixture.example/report',fetchedAt:'2026-11-06T00:00:00Z'},tags:[],body:'The original reports 56 stores.',importedAt:'2026-11-06T00:00:00Z',status:'unprocessed',bodySha256:'a'.repeat(64)};
const translation:RawTranslation={rawId:raw.id,rawSha256:raw.bodySha256,status:'completed',body:'原文报告 56 家门店。',attempts:1,completedChunks:1,totalChunks:1};
const failed:RawTranslation={rawId:raw.id,rawSha256:raw.bodySha256,status:'failed',attempts:0,completedChunks:0,totalChunks:0,error:{code:'TRANSLATION_START_FAILED',message:'原文已保存，翻译未能启动。'}};
const none=()=>{};
const settled=async()=>{};
const pageProps={onOpenImport:none,onDeleted:settled,processing:{},job:null,onJobStarted:none,onOpenDraft:none,onRefresh:settled};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const click=(text:string)=>act(async()=>{const button=[...w.document.querySelectorAll('button')].find(item=>item.textContent?.trim()===text);assert(button,text);button.click();});
const tick=async(check:()=>boolean)=>{for(let i=0;i<100;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});if(check())return;}assert.fail('Raw reader did not settle');};

test('RAWZH01 surfaces an import response startup failure even before a translation record can be read; retry uses the committed Raw',async()=>{
  const native=globalThis.fetch, posts:string[]=[];
  let persisted:RawTranslation|null=null;
  globalThis.fetch=async (input,options)=>{
    const route=String(input);
    if(options?.method==='POST')posts.push(route);
    if(route==='/api/raw/import')return reply({kind:'url',raw,translation:failed,extraction:{parser:'url_html_text',note:'fixture',bodyChars:raw.body.length}},201);
    if(route===`/api/raw/${raw.id}/translation/retry`){persisted=translation;return reply({translation});}
    if(route===`/api/raw/${raw.id}/translation`)return reply({translation:persisted});
    return reply({items:[]});
  };
  const root=createRoot(w.document.getElementById('root')!);
  function Harness(){
    const [items,setItems]=useState<Raw[]>([]),[id,setId]=useState<string|null>(null),[open,setOpen]=useState(true);
    return createElement(RawPage,{...pageProps,items,selectedId:id,openImport:open,onSelected:setId,onCommitted:async committed=>{setItems([committed]);},onCloseImport:()=>setOpen(false)});
  }
  try {
    await act(async()=>root.render(createElement(Harness)));
    const url=w.document.querySelector<HTMLInputElement>('input[type=url]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value')!.set!.call(url,raw.url);url.dispatchEvent(new w.Event('input',{bubbles:true}));});
    await click('从网页导入 Raw');
    await tick(()=>w.document.body.textContent!.includes('原始资料已保存，中文翻译未完成。'));
    assert.equal(w.document.querySelector('.raw-body')!.textContent,raw.body);
    await click('重试翻译');
    await tick(()=>w.document.querySelector('.raw-body')!.textContent===translation.body);
    assert.deepEqual(posts,['/api/raw/import',`/api/raw/${raw.id}/translation/retry`]);
  } finally {await act(async()=>root.unmount());globalThis.fetch=native;}
});

test('RAWZH01 never renders a translation bound to a different source checksum',async()=>{
  const native=globalThis.fetch, posts:string[]=[];
  globalThis.fetch=async (input,options)=>{
    if(options?.method==='POST')posts.push(String(input));
    return String(input).endsWith('/translation')?reply({translation:{...translation,rawSha256:'b'.repeat(64)}}):reply({items:[]});
  };
  const root=createRoot(w.document.getElementById('root')!);
  try {
    await act(async()=>root.render(createElement(RawPage,{...pageProps,items:[raw],selectedId:raw.id,openImport:false,onSelected:none,onCommitted:settled,onCloseImport:none})));
    assert.equal(w.document.querySelector('.raw-body')!.textContent,raw.body);
    assert.equal(w.document.querySelector('[aria-label="正文语言"]'),null);
    assert.deepEqual(posts,[]);
  } finally {await act(async()=>root.unmount());globalThis.fetch=native;}
});
