import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,readFile,readdir,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lwFixture } from '../lw01-fixture.ts';
import { PromptStore } from '../../services/prompt/store.ts';
import { WorkItemStore } from '../../services/work-items/store.ts';
import { AutomationLedger } from '../../services/automation/ledger.ts';
import { WikiLintSnapshots } from '../../services/automation/tasks/wiki-lint.ts';

export async function formalHashes(root) {
  const hashes={};
  for(const folder of ['knowledge/wiki','knowledge/raw','prompts','work-items']){
    const base=path.join(root,folder);
    for(const entry of await readdir(base,{recursive:true,withFileTypes:true})){
      if(!entry.isFile()) continue;
      const f=path.join(entry.parentPath,entry.name);
      hashes[path.relative(root,f)]=createHash('sha256').update(await readFile(f)).digest('hex');
    }
  }
  return hashes;
}

export async function createWeeklyFixture(){
  const run=await mkdtemp(path.join(os.tmpdir(),'review01-accept-'));
  const data=path.join(run,'data'), envDir=path.join(run,'vite-env'), config=path.join(run,'empty-provider.env');
  await mkdir(envDir); await writeFile(config,'');
  const now=new Date();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now);
  const local=new Date(today+'T00:00:00Z'), daysSinceMon=(local.getUTCDay()+6)%7, day=86400000;
  const monday=new Date(+local-(7+daysSinceMon)*day);
  const periodStart=monday.toISOString().slice(0,10),periodEnd=new Date(+monday+7*day).toISOString().slice(0,10);
  const mid=new Date(+monday+3*day+3*3600000).toISOString(),usedOn=mid.slice(0,10);
  const thursday=new Date(+monday+3*day),year=thursday.getUTCFullYear();
  const weekKey=year+'-W'+String(Math.ceil(((+thursday-Date.UTC(year,0,1))/day+1)/7)).padStart(2,'0');
  const safeTitles=['合成门店陈列指引','合成陈列反馈模板','合成陈列跟进','合成渠道产品评估'];
  const forbidden=['PRIVATE_RAW_BODY','PRIVATE_MEETING_NAME','PRIVATE_DERIVED_TOPIC','PRIVATE_WORK_HISTORY','PRIVATE_WORK_FEEDBACK','PRIVATE_PROMPT_BODY','PRIVATE_PROMPT_FEEDBACK','PRIVATE_GOAL','PRIVATE_WIKI_BODY'];
  const f=await lwFixture(data),prompts=new PromptStore(data,f.wiki),work=new WorkItemStore(data,f.rawStore);
  await prompts.initialize();
  const raw=await f.rawStore.create({title:'合成可用源',body:forbidden[0],sourceType:'report',sourceName:'合成资料',tags:[]});
  const meeting=await f.rawStore.createMeetingRegistration({id:randomUUID(),title:forbidden[1],body:'PRIVATE_MEETING_BODY',sourceName:'合成本机源',importedAt:mid,tags:[],origin:{kind:'meeting',meeting_id:randomUUID(),import_id:randomUUID(),original_sha256:'6'.repeat(64),registered_confidentiality:'Restricted',processing_policy:'meeting_local_only'}});
  const fields={type:'concept',category:'industry_basics',sources:[raw.id],tags:[],aliases:[],knowledge_status:'source_supported',confidence:'medium',source_level:'D',review_status:'unreviewed',body:forbidden[8]};
  const page=await f.wiki.create({...fields,title:safeTitles[0]});
  await f.wiki.writePageLocked({...page,created:mid,updated:mid});
  const hidden={...page,id:randomUUID(),title:forbidden[2],created:mid,updated:mid,sources:[meeting.record.id]};await f.wiki.writePageLocked(hidden);
  await f.wiki.rebuildIndexLocked();
  const prompt=(await prompts.create(randomUUID(),{name:safeTitles[1],category:'customer',scenario:'合成场景',body:forbidden[5],inputRequirements:'合成输入',outputRequirements:'合成输出',relatedWikiIds:[page.id],examples:'',tags:[],favorite:false})).prompt;
  await prompts.createFeedback(prompt.id,{id:randomUUID(),promptVersion:1,usedOn,scenario:'合成场景',outcome:'helpful',observation:forbidden[6],nextImprovement:forbidden[6]});
  const customer=await work.create({title:safeTitles[2],feedback:forbidden[4]});
  const due=await work.update(customer.id,{baseRevision:customer.revision,status:'waiting',followUpOn:usedOn,history:{kind:'technical_reply',body:forbidden[3]}});
  const product=await work.create({kind:'product_analysis',title:safeTitles[3],goal:forbidden[7]});
  for(const record of [due,product]) await writeFile(path.join(data,'work-items',record.id+'.json'),JSON.stringify({...record,createdAt:mid,updatedAt:mid}));
  const ledger=new AutomationLedger(data);await ledger.initialize();
  const lintId=randomUUID(),newsId=randomUUID();
  for(const [type,id] of [['wiki.lint',lintId],['news.daily',newsId]]){
    await ledger.save({type,id,trigger:'schedule',scheduledAt:mid,startedAt:mid,endedAt:mid,status:'succeeded',steps:[],budget:null,
      usage:{requests:0,inputTokens:0,outputTokens:0,unknownUsageCount:0},artifacts:{rawIds:[],draftIds:[],jobIds:[],...(type==='wiki.lint'?{lintSnapshotId:id}:{})},...(type==='news.daily'?{sourceRequests:3}:{})});
  }
  await new WikiLintSnapshots(data).save({runId:lintId,checkedAt:mid,total:0,byCode:{},findings:[],diff:{isBaseline:true,previousRunId:null,addedCount:0,resolvedCount:0,unchangedCount:0,added:[],resolved:[]}});
  const cache={status:'source_only',attempt:1,startedAt:now.toISOString(),finishedAt:now.toISOString(),sources:[],items:[]};
  await mkdir(path.join(data,'state/news'),{recursive:true});
  await writeFile(path.join(data,'state/news',today+'.json'),JSON.stringify({schemaVersion:1,date:today,updatedAt:now.toISOString(),sections:{ai:cache,fmcg:{...cache,contentVersion:'research-v1'}}}));
  const protectedHashes=await formalHashes(data);assert(Object.keys(protectedHashes).length>=7);
  return {run,data,envDir,config,weekKey,periodStart,periodEnd,safeTitles:[...safeTitles,'合成可用源'],forbidden:[...forbidden,'PRIVATE_MEETING_BODY',meeting.record.id,hidden.id],knownIds:[page.id,prompt.id,raw.id,customer.id,product.id,lintId,newsId],protectedHashes};
}
