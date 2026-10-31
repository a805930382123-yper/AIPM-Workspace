import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RawPage } from '../app/pages/RawPage.tsx';
import type { Raw, RawProcessingState, ExtractionJob } from '../app/api.ts';

const raw: Raw = {id:'raw-a',title:'虚构资料甲',sourceType:'report',sourceName:'测试',tags:[],body:'正文',importedAt:'2026-10-01T00:00:00Z',status:'unprocessed',bodySha256:'a'};
const base: ExtractionJob = {jobId:'job-a',rawId:raw.id,status:'running',stage:'planning',execution:'running',mode:'deep',progress:{chunksTotal:2,chunksDone:2,pagesFound:3},draftId:null,error:null,provider:{name:'fake',model:'fake'},callCount:2,startedAt:'2026-10-01T00:00:00Z',finishedAt:null,cancelRequested:false,pipelineVersion:'test',checkpoint:{stage:'planning',deepStage:'writing',validatedChunks:2,totalChunks:2,attempts:2,reusedChunks:1,resumable:true}};
const view = (status: RawProcessingState['status'], job: ExtractionJob | null, extra: Partial<RawProcessingState> = {}, item=raw) => renderToStaticMarkup(createElement(RawPage,{items:[item],selectedId:item.id,onSelected:()=>{},onOpenImport:()=>{},onCommitted:async()=>{},openImport:false,onCloseImport:()=>{},onDeleted:async()=>{},processing:{[item.id]:{rawId:item.id,status,updatedAt:'2026-10-01T00:00:00Z',...extra}},job,onJobStarted:()=>{},onOpenDraft:()=>{},onRefresh:async()=>{}}));
test('状态与保留结果根据实际证据显示，段数不是整项进度',()=>{
 const running=view('processing',base); assert.ok(running.indexOf('虚构资料甲') < running.indexOf('当前阶段')); assert.match(running,/写作/); assert.match(running,/已验证 2\/2 提取段/); assert.match(running,/不是整项完成比例/); assert.doesNotMatch(running,/草稿已保存/);
 const standard=view('processing',{...base,mode:'standard',stage:'extracting'}); assert.match(standard,/当前阶段/); assert.match(standard,/提取/);
 const pending=view('pending_confirmation',{...base,status:'completed',stage:'done'}, {draftId:'draft-a'}); assert.match(pending,/草稿已保存，待你审核/); assert.match(pending,/继续审核/); assert.doesNotMatch(pending,/已确认写入/);
 const generated=view('generated',null,{generatedWikiIds:['wiki-a']}); assert.match(generated,/已确认写入/); assert.match(generated,/wiki-a/);
 const legacy=view('failed',null); assert.match(legacy,/暂无可确认的已保存结果/); assert.doesNotMatch(legacy,/已验证/);
});
test('恢复按钮按模式、故障和来源区分',()=>{
 const failure={...base,status:'failed' as const,execution:'settled' as const,error:{code:'LLM_PLAN_COVERAGE_INVALID',message:'覆盖不足'}};
 const standard=view('failed',{...failure,mode:'standard'}); assert.match(standard,/仅重新规划（带覆盖诊断）/); assert.match(standard,/沿用原任务标准模式/); assert.match(standard,/按当前选择模式重新生成/);
 assert.doesNotMatch(view('failed',failure),/仅重新规划（带覆盖诊断）/);
 const recovery={code:'IO',message:'无法保存',persisted:false as const,phase:'done',action:'reconcile-storage' as const};
 const running=view('failed',{...failure,recovery,execution:'running'}); assert.match(running,/任务正在停止，状态保存失败/); assert.match(running,/disabled=""[^>]*>重试保存状态/);
 const settled=view('processing',{...failure,recovery}); assert.match(settled,/当前阶段：<\/b>已停止，状态保存失败/); assert.doesNotMatch(settled,/当前阶段：<\/b>写作/); assert.match(settled,/不会重新调用模型/); assert.match(settled,/重试保存状态/);
 const meeting={...raw,origin:{kind:'meeting' as const,meeting_id:'m',import_id:'i',original_sha256:'a',registered_confidentiality:'Internal' as const,processing_policy:'meeting_local_only' as const}}; assert.doesNotMatch(view('unprocessed',null,{},meeting),/AI 整理知识/);
 assert.match(view('unprocessed',null,{}, {...raw,body:'x'.repeat(30001)}),/正文超过30000字符/);
});

test('继续沿用原模式，重新生成使用当前选择', async()=>{
 const { JSDOM } = await import('jsdom'); const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true}); const w=dom.window;
 for(const [name,value] of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLSelectElement:w.HTMLSelectElement,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
 const {act}=await import('react'); const {createRoot}=await import('react-dom/client'); const original=globalThis.fetch; const calls:any[]=[];
 globalThis.fetch=async (input,init)=>{const url=String(input); if(url.endsWith('/extract')) {calls.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(base));} return new Response(JSON.stringify({items:[]}));};
 const job={...base,status:'failed' as const,execution:'settled' as const,error:{code:'OTHER',message:'失败'}};
 const props={items:[raw],selectedId:raw.id,onSelected:()=>{},onOpenImport:()=>{},onCommitted:async()=>{},openImport:false,onCloseImport:()=>{},onDeleted:async()=>{},processing:{[raw.id]:{rawId:raw.id,status:'failed' as const,updatedAt:'2026-10-01T00:00:00Z'}},job,onJobStarted:()=>{},onOpenDraft:()=>{},onRefresh:async()=>{}};
 const root=createRoot(w.document.getElementById('root')!); try {await act(async()=>{root.render(createElement(RawPage,props));}); const select=w.document.querySelector('select[aria-label="整理模式"]') as HTMLSelectElement; await act(async()=>{select.value='standard';select.dispatchEvent(new w.Event('change',{bubbles:true}));});
 for(const label of ['显式继续提取','明确重新生成']) {const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!; await act(async()=>{button.click();await new Promise(r=>setTimeout(r,0));});}
 assert.deepEqual(calls,[{mode:'deep'},{restart:true,mode:'standard'}]);
 } finally {await act(async()=>root.unmount());globalThis.fetch=original;dom.window.close();}
});
