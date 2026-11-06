import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RawStore} from '../services/raw/store.ts';
import {RawStateStore} from '../services/raw/state.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {DraftStore,type DraftRecord} from '../services/wiki/drafts.ts';
import {WikiCommitService} from '../services/wiki/commits.ts';
import {ExtractionJobStore,ExtractionRunner} from '../services/llm/jobs.ts';
import {LLMService} from '../services/llm/service.ts';
import {loadExtractionRules} from '../services/llm/rules.ts';
import {maintenanceDigest} from '../services/wiki/maintenance.ts';
import type {LlmCompletionRequest,LlmProvider} from '../services/llm/provider.ts';
import {deepReply} from './support/kb03-deep-fixture.ts';

export async function lwFixture(existingRoot?:string){
  const root=existingRoot??await mkdtemp(path.join(os.tmpdir(),'lw01-'));
  const rawStore=new RawStore(root),rawStates=new RawStateStore(root),wiki=new WikiStore(root,rawStore),drafts=new DraftStore(root),jobs=new ExtractionJobStore(root);
  await Promise.all([rawStore.initialize(),rawStates.initialize(),drafts.initialize(),jobs.initialize()]);await wiki.initialize();
  const requests:LlmCompletionRequest[]=[];let topics=['渠道覆盖'],failure:string|undefined;
  const provider:LlmProvider={name:'fake',model:'lw01-engineering-only',complete:async request=>{
    requests.push(request);const data=JSON.parse(request.user.split('\n').at(-1)!);let result:unknown;
    if(failure&&data.stage===failure){failure=undefined;throw Error('LW01 controlled model failure');}
    if(data.stage==='maintenance')result={version:1,changes:data.pages.map((p:any,pageIndex:number)=>{
      const old=data.context.find((r:any)=>r.title===p.title||r.aliases.includes(p.title));
      const action=old?(old.sources.includes(data.source.id)?'noop':p.title==='渠道指标定义'?'link':'update'):'create';
      const incoming=p.source_facts.map((f:any)=>f.text).join('\n');
      const body=action==='noop'||action==='link'?old.body:(old?old.body+'\n\n## 本次来源事实\n'+incoming+'\n\n## 待核矛盾\n不同年份与统计口径并列，2025和2026不可直接比较；两份2026渠道数据不一致，待核。':'## 来源事实\n'+incoming+'\n\n## 整理\n渠道覆盖按年份和统计口径分别记录。');
      return {pageIndexes:[pageIndex],action,targetWikiId:old?.id??null,baseRevision:old?.revision??null,title:old?.title??p.title,body,aliases:[],tags:['渠道'],reason:old?'对照真实Wiki正文、版本及来源形成维护提议。':'该主题尚无已有页面。',summary:old?['保留旧有效内容与人工补充','并列新增资料及年份口径，矛盾待核']:['根据本份资料创建新主题'],questions:old?['2026两份资料数值口径不一致，待确认。']:[],dependsOn:[]};
    })};
    else if(request.system.startsWith('KB03 '))result=deepReply(request);
    else if(request.user.includes('请对下列全部已验证事实规划知识页')){
      const count=Math.min(topics.length,data.factUnits.length),owner=(f:any,n:number)=>count===2&&data.factUnits.some((u:any)=>u.text.includes('回访'))?(f.text.includes('回访')?1:0):n%count;result={version:3,document:{title:data.source.title+' · 来源笔记',main_topic:'渠道知识',source_level:'D'},pages:Array.from({length:count},(_,i)=>({title:topics[i],type:'metric',category:'channel',factUnitIds:data.factUnits.filter((f:any,n:number)=>owner(f,n)===i).map((f:any)=>f.id),questionUnitIds:data.questionUnits.filter((_:unknown,n:number)=>n%count===i).map((q:any)=>q.id)}))};
    }else result={version:2,facts:data.map((a:any)=>({atomId:a.id,kind:a.text.includes('疑点')?'ambiguous':'fact'})),questions:[],sourceNotes:[]};
    const text=JSON.stringify(result);return{text,bytes:Buffer.byteLength(text),finishReason:'stop'};
  }};
  const rulesDir=path.resolve('rules'),deps={root,rawStore,rawStates,jobs,drafts,provider:()=>provider,llm:new LLMService(rulesDir),rulesDir,draftRules:async()=>{const b=await loadExtractionRules(rulesDir);return {types:['metric'],categories:['channel'],...b.fmcg.enums} as any;}};
  const runner=new ExtractionRunner(deps),commits=new WikiCommitService({root,rawStore,rawStates,wikiStore:wiki,drafts});await commits.initialize();
  const generate=async(rawId:string,mode:'standard'|'deep'='standard',restart=false)=>{const started=await runner.start(rawId,{mode,restart,newJobId:randomUUID(),now:new Date().toISOString()});await runner.waitForSettlement(started.job.id);const job=(await jobs.get(started.job.id))!;if(job.status!=='completed')throw Error(JSON.stringify(await runner.readJob(job.id)));return (await drafts.get(job.draftId!))!;};
  const accept=async(draft:DraftRecord,ids=draft.maintenance!.changes.map(c=>c.changeId))=>{let next=draft;for(const id of ids)next=await drafts.reviewChange(next.id,{baseRevision:next.revision,changeId:id,decision:'accept'});for(const id of ids)next=await drafts.reviewChange(next.id,{baseRevision:next.revision,changeId:id,confirmed:true,digest:maintenanceDigest(next,id)});if(next.structuredNote)next=await drafts.reviewStructuredNote(next.id,{baseRevision:next.revision,reviewContentDigest:drafts.contentDigest(next),warningsAcknowledged:true,historicalReportAcknowledged:true},(await rawStore.get(next.rawId))!.body);return next;};
  const confirm=async(draft:DraftRecord,key:string=randomUUID())=>wiki.withLock(()=>commits.confirm({draftId:draft.id,baseRevision:draft.revision,selectedPageIds:draft.maintenance!.changes.filter(c=>c.decision==='accept'&&!c.committedOperationId).map(c=>draft.pages[c.pageIndex].pageId),idempotencyKey:key,operationId:randomUUID(),now:new Date().toISOString()}));
  return {root,rawStore,rawStates,wiki,drafts,jobs,runner,commits,provider,requests,generate,accept,confirm,setTopics:(v:string[])=>{topics=v;},failOnce:(stage:string)=>{failure=stage;},newRunner:()=>new ExtractionRunner(deps)};
}
