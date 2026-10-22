import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import {buildKnowledgeAtoms} from '../../services/llm/knowledge-atoms.ts';
import {buildEvidenceLocatorCatalog} from '../../services/llm/locators.ts';
import {chunkText} from '../../services/llm/chunk.ts';
import {runKnowledgePipeline} from '../../services/llm/knowledge-extraction.ts';
const prefix='docs/reports/KB02-EDGE-20261022-',sha=b=>createHash('sha256').update(b).digest('hex');
const original=JSON.parse(await fs.readFile('docs/reports/KB02-SOURCE-AUDIT-20261022-short-failure.json','utf8')),report={at:new Date().toISOString(),realProviderCalls:0,short:{},ui:{}};
assert.equal(sha(original.raw.body),original.raw.bodySha256);assert.equal(original.raw.body.length,134);
const pieces=chunkText(original.raw.body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}),atoms=buildKnowledgeAtoms(original.raw.body,buildEvidenceLocatorCatalog(original.raw.body,pieces[0]));
assert.equal(atoms.map(a=>a.text).join(''),original.raw.body);const blank=atoms.filter(a=>!a.text.trim());assert.deepEqual(blank.map(a=>a.id),['c1-a0005']);
async function replay(response){let cp=structuredClone(original.checkpoint),request;const provider={name:'offline',model:'replay-only',complete:async r=>{assert(!request);request=r;return {text:JSON.stringify(response),bytes:1,finishReason:'stop'};}};let error;
 try{await runKnowledgePipeline({raw:original.raw,body:original.raw.body,bodySha256:original.raw.bodySha256,checkpoint:cp,rulesDir:'rules',provider,beforeCall:async stage=>cp={...cp,stage,attempts:cp.attempts+1},saveCheckpoint:async value=>cp=value});}catch(e){error={code:e.code,message:e.message};}
 assert.deepEqual(error,{code:'LLM_SCHEMA_INVALID',message:'不能将空白分隔符选择为陈述。'});assert.equal(cp.completedChunks.length,0);assert(!cp.plan);assert.equal(cp.attempts,original.checkpoint.attempts+1);const sent=JSON.parse(request.user.split('\n').at(-1));assert(sent.some(a=>a.id===blank[0].id));return {error,calls:1,completedChunks:cp.completedChunks.length,attempts:cp.attempts,blankVisibleInActualRequest:true};
}
report.short.originalReplay=await replay(original.response);report.short.allColumns={};
for(const column of ['facts','questions','sourceNotes']){const response=structuredClone(original.response);response.sourceNotes=response.sourceNotes.filter(i=>i.atomId!==blank[0].id);response[column].push({atomId:blank[0].id,...(column==='facts'?{kind:'fact'}:{})});report.short.allColumns[column]=await replay(response);}
const samples=[original.raw.body,'\n\n  \t\r\n','\n\t【来源说明】\n甲区20家。\n\n乙区30家。','\u00a0\n\u2003\n甲区20家。','甲'.repeat(511)+'😀。\n乙区30家。','\u200b\n甲区20家。'];
report.short.proposedInputProjection=samples.map(body=>{const chunks=chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}),all=chunks.flatMap(c=>buildKnowledgeAtoms(body,buildEvidenceLocatorCatalog(body,c))),selected=all.filter(a=>a.text.trim().length>0);
 assert.deepEqual(selected,all.filter(a=>a.text.trim()));for(const a of selected)assert.equal(body.slice(a.start,a.end),a.text);for(let i=0;i<body.length;i++)if(body[i].trim())assert(selected.some(a=>a.start<=i&&i<a.end));
 return {chars:body.length,atomCount:all.length,blankCount:all.length-selected.length,retainedIds:selected.map(a=>a.id),allNonWhitespaceCharactersCovered:true,exactTextAndStableOriginalIds:true};});
report.short.blank=blank;report.short.originalSelectedBusinessIds=original.response.facts.map(a=>a.atomId);report.short.nonemptySourceNotePreserved=atoms.find(a=>a.id==='c1-a0001');
report.short.noBusinessBoundaries=[];
for(const body of ['\n \t\r\n','【虚构来源声明】\n']){
 const descriptors=chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(({index,start,end})=>({index,start,end}));let cp={...structuredClone(original.checkpoint),rawSha256:sha(body),chunks:descriptors,completedChunks:[],attempts:0,lastError:undefined},calls=0,error;
 const selectable=buildKnowledgeAtoms(body,buildEvidenceLocatorCatalog(body,{...descriptors[0],text:body})).filter(a=>a.text.trim());
 try{await runKnowledgePipeline({raw:{...original.raw,body},body,bodySha256:sha(body),checkpoint:cp,rulesDir:'rules',provider:{name:'offline',model:'empty-only',complete:async()=>{calls++;return {text:JSON.stringify({version:2,facts:[],questions:[],sourceNotes:selectable.map(a=>({atomId:a.id}))}),bytes:1,finishReason:'stop'};}},beforeCall:async stage=>cp={...cp,stage,attempts:cp.attempts+1},saveCheckpoint:async value=>cp=value});}catch(e){error={code:e.code,message:e.message};}
 assert.equal(error.code,'LLM_EMPTY_RESULT');assert.equal(calls,1);assert.equal(cp.completedChunks.length,1);assert(!cp.plan);report.short.noBusinessBoundaries.push({chars:body.length,retainedSourceNotes:cp.completedChunks[0].sourceNotes.length,calls,checkpointAttempts:cp.attempts,error,planAbsent:true});
}
// Real component, local in-memory fetch stubs only. No HTTP server or external browser is started.
const {JSDOM}=await import('jsdom'),dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),{window}=dom;
for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,HTMLSelectElement:window.HTMLSelectElement,Event:window.Event,MouseEvent:window.MouseEvent,CustomEvent:window.CustomEvent,Node:window.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{WikiPage}=await import('../../app/pages/WikiPage.tsx');
const a={id:'wiki-a',title:'虚构指标甲',type:'metric',category:'metric',aliases:[],tags:[],sources:[],body:'甲正文20%',revision:1,created:'2026-10-01',updated:'2026-10-01',knowledge_status:'needs_verification',review_status:'unreviewed',confidence:'low',source_level:'D',links:[]},b={...a,id:'wiki-b',title:'虚构指标乙',body:'乙正文30%'},schema={types:[{id:'metric',label:'指标'}],categories:[{id:'metric',label:'指标'}],pageTemplates:{},enums:{knowledge_status:['needs_verification'],confidence:['low'],source_level:['D'],review_status:['unreviewed']},sourcePolicy:{levels:[],guidance:''}};
const calls=[],response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});let delayB=false,releaseB,releaseSlow;
globalThis.fetch=async(url,init={})=>{assert.equal(init.method??'GET','GET');url=String(url);assert(url.startsWith('/api/'));calls.push(url);
 if(url==='/api/wiki/schema')return response(schema);if(url.startsWith('/api/raw?')||url.startsWith('/api/drafts?')||url==='/api/knowledge/workflows'||url.startsWith('/api/audits?'))return response({items:[]});
 if(url==='/api/wiki/wiki-a')return response(a);if(url==='/api/wiki/wiki-b'){if(delayB)return new Promise(resolve=>{releaseB=()=>resolve(response(b));});return response(b);}
 if(url.startsWith('/api/wiki?')){const q=new URL(url,'http://localhost/').searchParams.get('q');if(q==='慢')return new Promise(resolve=>{releaseSlow=()=>resolve(response({items:[a],categoryCounts:{metric:1}}));});return response({items:q==='快'?[b]:[a,b],categoryCounts:{metric:q==='快'?1:2}});}
 throw Error('Unstubbed '+url);
};
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms)),root=createRoot(window.document.getElementById('root')),detail=()=>window.document.querySelector('.wiki-detail')?.textContent??'',list=()=>[...window.document.querySelectorAll('.wiki-list-item')].map(x=>x.textContent),button=id=>[...window.document.querySelectorAll('.wiki-list-item')].find(x=>x.textContent.includes(id));
async function wait(check,label){for(let i=0;i<100;i++){if(check())return;await act(async()=>{await tick(10);});}throw Error('Timeout '+label);}
async function click(target){assert(target);await act(async()=>{target.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await tick(0);});}
async function search(value){await act(async()=>{const input=window.document.querySelector('[aria-label="搜索 Wiki"]');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));await tick(0);});}
try{
 await act(async()=>{root.render(createElement(WikiPage,{onOpenRaw:()=>{},onChanged:()=>{}}));await tick(0);});await wait(()=>detail().includes('甲正文20%'),'initial detail');
 const before=calls.filter(x=>x==='/api/wiki/wiki-a').length;await click(button(a.title));assert.equal(detail(),'');await act(async()=>{await tick(120);});assert.equal(detail(),'');assert.equal(calls.filter(x=>x==='/api/wiki/wiki-a').length,before);report.ui.sameItem={initiallyLoaded:true,clearedAfterReclick:true,detailCallsBefore:before,detailCallsAfter:before,stillEmptyAfter120ms:true};
 await click(button(b.title));await wait(()=>detail().includes('乙正文30%'),'B');await click(button(a.title));await wait(()=>detail().includes('甲正文20%'),'A restored');report.ui.switchRestores=true;
 delayB=true;await click(button(b.title));await wait(()=>!!releaseB,'B delayed request');await click(button(a.title));await wait(()=>detail().includes('甲正文20%'),'A during delayed B');await act(async()=>{releaseB();await tick(0);});assert(detail().includes('甲正文20%'));delayB=false;report.ui.delayedOtherDetailIgnored=true;
 await search('慢');await wait(()=>!!releaseSlow,'slow search');await search('快');await wait(()=>list().length===1&&list()[0].includes(b.title)&&detail().includes('乙正文30%'),'latest search');await act(async()=>{releaseSlow();await tick(0);});assert(list().length===1&&list()[0].includes(a.title));assert(detail().includes('乙正文30%'));report.ui.staleSearchList={observed:true,query:window.document.querySelector('[aria-label="搜索 Wiki"]').value,visibleItems:list(),detailStillB:true};
 report.ui.requests=calls;
}finally{await act(async()=>root.unmount());dom.window.close();}
await fs.writeFile(prefix+'diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify({shortOriginal:report.short.originalReplay,columns:Object.keys(report.short.allColumns),projectionSamples:report.short.proposedInputProjection.length,ui:{...report.ui,requests:undefined},realProviderCalls:0}));
