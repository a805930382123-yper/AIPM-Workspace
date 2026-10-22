import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {RawStore} from '../../services/raw/store.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
import {type LlmCompletionRequest, type LlmProvider} from '../../services/llm/provider.ts';

const oldBody='目标门店100家。铺货率=在售门店数÷目标门店数，旧值20%。门店数不等于销量。AI未上线，仅建议将来用于分析。异常审批负责人未知。\nKB02_HUMAN 人工口径备注。';
const newBody='目标门店总数为100家。铺货率=在售门店数÷目标门店数，新值30%。本期新增渠道复核。AI未上线，仅建议将来用于分析。异常审批负责人未知。';
const empty=()=>({suggestedAdditions:[] as any[],conflicts:[] as any[],agreement:[] as any[],inferences:[] as string[],openQuestions:[] as string[]});
async function fixture(existing=oldBody,incoming=newBody){
 const root=await mkdtemp(path.join(os.tmpdir(),'kb02-final-agreement-')),raws=new RawStore(root);await raws.initialize();const wiki=new WikiStore(root,raws);await wiki.initialize();const workflows=new KnowledgeWorkflowStore(root,wiki,raws);await workflows.initialize();
 const first=await raws.create({title:'虚构旧来源',sourceType:'report',sourceName:'隔离',tags:[],body:existing}),raw=await raws.create({title:'虚构新来源',sourceType:'report',sourceName:'隔离',tags:[],body:incoming});
 const target=await wiki.create({title:'虚构指标',type:'metric',category:'metric',sources:[first.id],tags:[],knowledge_status:'source_supported',confidence:'medium',source_level:'C',review_status:'unreviewed',aliases:[],body:existing});
 const draftId=randomUUID(),pageId=randomUUID(),draft={id:draftId,rawId:raw.id,revision:1,rawSha256:raw.bodySha256,pages:[{pageId,source_facts:[{text:incoming,evidenceIds:['new-e1']}],source_evidence:[{id:'new-e1',rawId:raw.id,quote:incoming,start:0,end:incoming.length}],ai_organized:[],ai_inferences:[],open_questions:[]}]};
 const requests:LlmCompletionRequest[]=[];let reply=(input:any):any=>({...empty(),agreement:[{text:'目标门店100家。',evidenceId:input.newSource.evidence[0].id,existingLocatorId:input.existing.locators[0].id}]});
 const provider:LlmProvider={name:'fake',model:'final-agreement',secrets:['synthetic-final-secret'],complete:async r=>{requests.push(r);return {text:JSON.stringify(await reply(JSON.parse(r.user))),bytes:1,finishReason:'stop'};}};
 const args={draftId,pageId,baseRevision:1,targetWikiId:target.id,draft,raw,target,provider};
 return {root,raws,wiki,workflows,first,raw,target,args,requests,setReply:(fn:typeof reply)=>{reply=fn;},run:()=>workflows.createUpdate(args),clean:()=>rm(root,{recursive:true,force:true})};
}

test('Independent stale supplied target rejects before Provider and zero workflow writes',async()=>{const f=await fixture();try{await f.wiki.update(f.target.id,f.target.revision,{...f.target,body:f.target.body+'\n新修订。'});await assert.rejects(f.run(),{code:'WIKI_REVISION_CONFLICT'});assert.equal(f.requests.length,0);assert.equal((await f.workflows.list()).length,0);}finally{await f.clean();}});
test('Independent same revision forged body rejects before Provider without replacing Wiki',async()=>{const f=await fixture();try{f.args.target={...f.target,body:f.target.body+'\n伪造同版本。'};await assert.rejects(f.run(),{code:'WIKI_REVISION_CONFLICT'});assert.equal(f.requests.length,0);assert.equal((await f.workflows.list()).length,0);assert.deepEqual(await f.wiki.get(f.target.id),f.target);}finally{await f.clean();}});
