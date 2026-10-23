import {persistedUpdateInput,approveWorkflow} from './support/human-review.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { KnowledgeWorkflowStore } from '../services/wiki/knowledge-workflows.ts';
import { RecoveryRegistry } from '../services/storage/recovery.ts';
import { isWorkflow } from '../services/storage/record-validators.ts';
import { JSON_SCAN_BUDGET, reportStorageIssue, storageObserverOverflow, takeStorageScanIssues } from '../services/storage/files.ts';

async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'pa01-r01-')),raws=new RawStore(root);await raws.initialize();const wiki=new WikiStore(root,raws);await wiki.initialize();const store=new KnowledgeWorkflowStore(root,wiki,raws);await store.initialize();
 const input=(title:string)=>({title,sourceType:'note' as const,sourceName:'虚构测试',author:'',sourceDate:'',url:'',body:'虚构资料',tags:[]});
 const a=await raws.create(input('虚构甲')),b=await raws.create(input('虚构乙'));let calls=0;
 const provider={name:'local-fixture',model:'fake',async complete(request: { system: string }){calls++;if(request.system.includes('evidenceId'))return {finishReason:'stop',bytes:256,text:JSON.stringify({suggestedAdditions:[{text:'虚构资料',evidenceId:'update-e1'}],conflicts:[],agreement:[],inferences:[],openQuestions:[]})};return {finishReason:'stop',bytes:256,text:JSON.stringify({title:'测试综合',category:'other',suggestedAdditions:[{text:'虚构资料',rawId:a.id,quote:a.body,start:0,end:a.body.length}],conflicts:[],agreement:[],inferences:[],openQuestions:[]})};}};
 const synthesis=await store.createSynthesis({rawIds:[a.id,b.id],provider});
 const target=await wiki.create({title:'手动目标',type:'concept',category:'other',sources:[b.id],tags:[],knowledge_status:'source_supported',confidence:'medium',source_level:'C',review_status:'unreviewed',aliases:[],body:'旧正文'});
 const pageId=randomUUID(),draftId=randomUUID(),draftInput={id:draftId,rawId:a.id,revision:1,rawSha256:a.bodySha256,pages:[{pageId,source_facts:[{text:a.body,evidenceIds:['update-e1']}],source_evidence:[{id:'update-e1',rawId:a.id,quote:a.body,start:0,end:a.body.length}],ai_organized:[],ai_inferences:[],open_questions:[]}]};
 const draft=await persistedUpdateInput(root,a,draftInput);
 const update=await store.createUpdate({draftId:draft.id,pageId:draft.pages[0].pageId,baseRevision:draft.revision,targetWikiId:target.id,draft,raw:a,target,provider});
 return {root,store,wiki,synthesis,update,calls:()=>calls};
}

test('PA01 R01 real workflow records reject deep corruption consistently before reads and writes',async()=>{
 const f=await fixture();try{
  const variants:Array<[string,typeof f.synthesis,(v:any)=>void]>=[
   ['kind array',f.synthesis,v=>v.kind=['synthesis']],['status array',f.synthesis,v=>v.status=['pending_confirmation']],['evidence section array',f.synthesis,v=>v.evidence[0].section=['suggestedAdditions']],['confirmed missing receipt',f.synthesis,v=>v.status='confirmed'],
   ['evidence object',f.synthesis,v=>v.evidence={}],['evidence null',f.synthesis,v=>v.evidence=null],['evidence element',f.synthesis,v=>v.evidence=[null]],
   ...['section','text','rawId','quote','start','end'].map(k=>['evidence '+k,f.synthesis,(v:any)=>v.evidence[0][k]={}] as [string,typeof f.synthesis,(v:any)=>void]),
   ['evidence foreign raw',f.synthesis,v=>v.evidence[0].rawId=randomUUID()],['evidence section',f.synthesis,v=>v.evidence[0].section='inferences'],['evidence range',f.synthesis,v=>v.evidence[0].end=-1],
   ['sourceList nested',f.synthesis,v=>v.sections.sourceList=[null]],['snapshot nested',f.synthesis,v=>v.rawSnapshots[0].bodySha256=12],['sources nested',f.synthesis,v=>v.sources=[{}]],
   ['existing type',f.update,v=>v.sections.existing=[]],['newSource type',f.update,v=>v.sections.newSource={}],['update missing target',f.update,v=>delete v.targetWikiId],['update base revision',f.update,v=>v.baseRevision=0],
   ['baseWiki nested',f.update,v=>v.baseWiki.sources={}],['baseWiki binding',f.update,v=>v.baseWiki.id=randomUUID()],['inputDraft nested',f.update,v=>v.inputDraft.pageId=[]],['inputDraft blank',f.update,v=>v.inputDraft.draftId='  '],['inputDraft revision',f.update,v=>v.inputDraft.revision=0],['wikiInput nested',f.update,v=>v.wikiInput={body:{}}],
   ['commit id',f.synthesis,v=>v.commitOperationId={}],['committed id',f.synthesis,v=>v.committedWikiId=[]],['last error',f.synthesis,v=>v.lastCommitError={}],['kind binding',f.update,v=>v.kind='synthesis'],
  ];
  for(const [name,healthy,mutate]of variants){
   const v=structuredClone(healthy);v.id=randomUUID();mutate(v);const file=path.join(f.root,'drafts','knowledge-workflows',v.id+'.json'),bytes=JSON.stringify(v);await writeFile(file,bytes);
   const recovery=(e:any)=>e.code==='STORAGE_CORRUPT'&&e.details?.category==='recovery';
   await assert.rejects(()=>f.store.get(v.id),recovery,name);assert(!(await f.store.list()).some(x=>x.id===v.id),name);
   await assert.rejects(()=>f.store.patch(v.id,1,healthy.sections,'编辑'),recovery,name);await assert.rejects(()=>f.store.confirm(v.id,1,randomUUID()),recovery,name);
   const registry=new RecoveryRegistry(f.root),scan=await registry.scan();assert(scan.items.some(x=>x.kind==='workflows'&&x.reason==='shape'),name);assert.deepEqual((await registry.scan()).items,scan.items);assert.equal(await readFile(file,'utf8'),bytes,name);
   await rm(file);assert.equal((await registry.scan()).items.length,0,name);
  }
  assert.equal((await f.store.list()).length,2);assert.equal(f.calls(),2);assert.equal((await f.wiki.allRecords()).length,1);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('PA01 R01 optional evidence and legacy unused snapshots remain readable editable confirmable',async()=>{
 const f=await fixture();try{for(const original of [f.synthesis,f.update]){const v=structuredClone(original);delete v.evidence;delete v.baseWiki;delete v.inputDraft;assert(isWorkflow(v));if(v.kind==='update')v.inputDraft=structuredClone(original.inputDraft);assert(isWorkflow(v));await f.store.save(v);assert((await f.store.get(v.id)));await f.store.patch(v.id,1,v.sections);const reviewed=await approveWorkflow(f.store,v.id);const result=await f.store.confirm(v.id,reviewed.revision,randomUUID());assert.equal(result.workflow.status,'confirmed');}assert.equal((await new RecoveryRegistry(f.root).scan()).items.length,0);}finally{await rm(f.root,{recursive:true,force:true});}
});

test('PA01 R02 499/500/501/1201 results are bounded with persistent hidden issues and correct rescan totals',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pa01-r02-'));try{const dir=path.join(root,'drafts','prompts');await mkdir(dir,{recursive:true});const files:string[]=[];const registry=new RecoveryRegistry(root);
 for(const count of [499,500,501,1201]){while(files.length<count){const p=path.join(dir,randomUUID()+'.json');files.push(p);await writeFile(p,'{broken');}const scan=await registry.scan();assert.equal(scan.scanned,true);assert.equal(scan.partial,false);assert.equal(scan.totalIssues,count);assert.equal(scan.items.length,Math.min(500,count));assert.equal(scan.truncated,count>500);assert.equal(scan.hiddenIssues,Math.max(0,count-500));assert.equal(scan.overflow,count>500);assert.equal(scan.scannedFiles,count);assert.deepEqual((await registry.scan()).items,scan.items);}
 const scan=await registry.scan(),visible=new Set(scan.items.map(x=>x.id));const hidden=files.find(p=>!visible.has(createHash('sha256').update(path.relative(root,p)).digest('hex').slice(0,16)))!;assert(hidden);await rm(hidden);let current=await registry.scan();assert.equal(current.totalIssues,1200);assert.equal(current.hiddenIssues,700);
 for(const p of files)await rm(p,{force:true});current=await registry.scan();assert.equal(current.totalIssues,0);assert.equal(current.truncated,false);assert.equal(current.overflow,false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('PA01 R02 file/byte/observer budgets remain bounded and partial count stays a lower bound',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pa01-r02-budget-'));try{const dir=path.join(root,'drafts','prompts');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,randomUUID()+'.json'),' '.repeat(JSON_SCAN_BUDGET.fileBytes+1));const scan=await new RecoveryRegistry(root).scan();assert.equal(scan.partial,true);assert.equal(scan.scanned,false);assert.equal(scan.overflow,true);assert(scan.scannedBytes<=JSON_SCAN_BUDGET.totalBytes);for(let i=0;i<10002;i++)reportStorageIssue(root,path.join(root,'unknown',String(i)),'shape');assert.equal(takeStorageScanIssues(root).length,10000);assert.equal(storageObserverOverflow(root),true);
 }finally{await rm(root,{recursive:true,force:true});}
});
