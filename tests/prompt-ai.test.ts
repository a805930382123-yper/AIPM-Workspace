import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { PromptAiService } from '../services/prompt-ai/service.ts';
import type { LlmProvider } from '../services/llm/provider.ts';

const preview = { name:'访谈分析', category:'customer', scenario:'经销商首次访谈', body:'还原订货流程。', inputRequirements:'访谈材料', outputRequirements:'流程与问题', relatedWikiIds:[], examples:'', tags:['访谈'], favorite:false };
const content = {version:1,name:preview.name,category:preview.category,scenario:preview.scenario,sections:[{heading:'任务目标',content:preview.body}],inputRequirements:preview.inputRequirements,outputRequirements:preview.outputRequirements,examples:preview.examples,tags:preview.tags};
const brief = { taskName:'经销商访谈', taskType:'客户访谈', role:'快消产品经理', goal:'还原订货流程', context:'首次访谈，现状未知', input:'访谈材料', tasks:'1. 询问流程\n2. 识别痛点', constraints:'不虚构事实', output:'流程与待确认问题' };
const checks = [['goal','present'],['role','present'],['context','missing'],['input','present'],['tasks','present'],['constraints','missing'],['output','missing'],['fact_inference','missing'],['anti_fabrication','missing']].map(([id,status])=>({id,status,evidence:'检查证据'}));
async function setup() {
  const root=await mkdtemp(path.join(process.cwd(),'.test-data-prompt-ai-'));
  const raw=new RawStore(root);await raw.initialize();const wiki=new WikiStore(root,raw);await wiki.initialize();const prompts=new PromptStore(root,wiki);await prompts.initialize();
  let response:unknown=brief;let rawResponse:string|undefined;const queue:unknown[]=[];const requests:string[]=[];
  const provider:LlmProvider={name:'test-provider',model:'test-model',async complete(request){requests.push(request.user);const output=rawResponse??JSON.stringify(queue.length?queue.shift():response);return {text:output,finishReason:'stop',bytes:Buffer.byteLength(output)};}};
  const ai=new PromptAiService(root,wiki,prompts,()=>provider);await ai.initialize();
  return {root,wiki,prompts,ai,requests,setResponse:(value:unknown)=>{response=value;queue.length=0;rawResponse=undefined;},setResponses:(values:unknown[])=>{queue.splice(0,queue.length,...values);rawResponse=undefined;},setRaw:(value:string)=>{rawResponse=value;},clean:()=>rm(root,{recursive:true,force:true})};
}
test('B08 Generator 保存预览草稿，编辑字段后显式确认；重试不重复创建且来源明确',async()=>{
  const s=await setup();try{
    const b=await s.ai.brief('第一次访谈经销商订货流程','customer_interview');assert.deepEqual(b.brief,brief);
    s.setResponse(content);const generated=await s.ai.generate({...brief,goal:'检查订货流程痛点'},[]);assert.equal(generated.preview.body,`## 任务目标\n\n${preview.body}`);
    assert.equal(await s.prompts.count(),0);
    const edited={...preview,body:'用户编辑后的正文 {{材料}}'};
    const first=await s.ai.confirm(generated.draftId,generated.draftId,'new',edited);assert.equal(first.prompt.source,'ai_generated');assert.deepEqual(first.prompt.variables,['材料']);
    assert.equal((await s.prompts.getVersions(first.prompt.id))[0].changeSource,'ai_generated');
    assert.equal((await s.ai.confirm(generated.draftId,generated.draftId,'new',edited)).reused,true);assert.equal(await s.prompts.count(),1);
    await s.prompts.update(first.prompt.id,1,{...edited,body:'后来手动编辑的第二版'});
    const retry=await s.ai.confirm(generated.draftId,generated.draftId,'new',edited);assert.equal(retry.prompt.version,1);assert.equal(retry.prompt.body,edited.body,'重试返回确认时写入的快照，不把后续编辑冒充原保存结果');
  }finally{await s.clean();}
});
test('B08 Wiki 背景只采用实际勾选页面片段，记录预算和知识状态',async()=>{
  const s=await setup();try{
    const selected=await s.wiki.create({title:'经销商订货',type:'business_process',category:'industry_basics',sources:[],tags:[],aliases:[],knowledge_status:'needs_verification',confidence:'low',source_level:'D',review_status:'reviewed',body:'经销商订单、补货周期与库存信息。'});
    await s.wiki.create({title:'不相关财务',type:'concept',category:'industry_basics',sources:[],tags:[],aliases:[],knowledge_status:'needs_verification',confidence:'low',source_level:'D',review_status:'reviewed',body:'只含另一项未选页面的秘密背景片段。'});
    const suggested=await s.ai.brief('第一次访谈经销商订货流程','customer_interview');assert.ok(suggested.wikiCandidates.some(item=>item.id===selected.id));
    s.setResponse({...content});
    const result=await s.ai.generate(brief,[selected.id]);assert.equal(result.relatedWiki[0].knowledgeStatus,'needs_verification');assert.ok(result.contextBudget.used>0);
    const sent=s.requests.at(-1)!;const request=JSON.parse(sent);assert.match(request.relatedWiki[0].excerpt,/经销商订单、补货周期/u);assert.doesNotMatch(sent,/秘密背景片段/u);
  }finally{await s.clean();}
});
test('B08 Wiki 多段摘录把段落分隔符计入每页与总预算',async()=>{
  const s=await setup();try{
    const ids:string[]=[];
    for(let i=0;i<5;i++){
      const page=await s.wiki.create({title:`经销商订货 ${i}`,type:'business_process',category:'industry_basics',sources:[],tags:[],aliases:[],knowledge_status:'needs_verification',confidence:'low',source_level:'D',review_status:'reviewed',body:`订货${'甲'.repeat(1_998)}\n\n订货${'乙'.repeat(1_998)}`});
      ids.push(page.id);
    }
    s.setResponse({...content});
    const result=await s.ai.generate(brief,ids);
    assert.ok(result.relatedWiki.every(page=>page.usedChars<=3_000));
    assert.ok(result.relatedWiki.reduce((sum,page)=>sum+page.usedChars,0)<=12_000);
    assert.equal(result.contextBudget.used,result.relatedWiki.reduce((sum,page)=>sum+page.usedChars,0));
  }finally{await s.clean();}
});
test('B08 Optimizer 校验九维缺项，更新原 Prompt 只追加 ai_optimized 版本',async()=>{
  const s=await setup();try{
    s.setResponses([{version:1,checks:checks.map(({id,status,evidence})=>({id,status,evidence})),improvements:checks.filter(x=>x.status==='missing').map(x=>({dimensionId:x.id,issue:`缺${x.id}`,action:`补${x.id}`}))},content]);
    const original=await s.prompts.create(crypto.randomUUID(),{...preview,body:'弱 Prompt'});
    const optimized=await s.ai.optimize('弱 Prompt','补充不虚构要求',original.prompt.id,1);
    assert.equal(optimized.checks.length,9);assert.equal(optimized.improvements.length,5);assert.equal(optimized.originalBody,'弱 Prompt');
    const edited={...preview,body:'改进后的完整版本'};const requestId=crypto.randomUUID();
    const saved=await s.ai.confirm(optimized.draftId,requestId,'version',edited);assert.equal(saved.prompt.version,2);assert.equal(saved.prompt.source,'manual');
    const history=await s.prompts.getVersions(original.prompt.id);assert.equal(history[0].snapshot.body,'弱 Prompt');assert.equal(history[1].changeSource,'ai_optimized');
    assert.equal((await s.ai.confirm(optimized.draftId,requestId,'version',edited)).reused,true);
  }finally{await s.clean();}
});
test('B08 Provider 非法 JSON 和不完整 Schema 不落草稿或正式 Prompt',async()=>{
  const s=await setup();try{
    s.setRaw('{broken');
    await assert.rejects(()=>s.ai.brief('整理客户访谈','customer_interview'),/合法 JSON/u);
    s.setResponse({taskName:'x'});
    await assert.rejects(()=>s.ai.brief('整理客户访谈','customer_interview'),/Brief 字段/u);
    assert.equal((await readdir(path.join(s.root,'drafts','prompts'))).length,0);assert.equal(await s.prompts.count(),0);
  }finally{await s.clean();}
});
test('B08 Provider Prompt 预览复用 B07 严格分类与字段长度规则，失败不落草稿',async()=>{
  const s=await setup();try{
    const badPreviews=[
      {...preview,category:'unknown-category'},
      {...preview,name:'名称\n换行'},
      {...preview,scenario:'x'.repeat(2_001)},
      {...preview,inputRequirements:'x'.repeat(10_001)},
      {...preview,examples:'x'.repeat(50_001)},
      {...preview,tags:['x'.repeat(61)]},
    ];
    for(const invalid of badPreviews){
      s.setResponse({...content,category:invalid.category,name:invalid.name,scenario:invalid.scenario,inputRequirements:invalid.inputRequirements,examples:invalid.examples,tags:invalid.tags});
      await assert.rejects(()=>s.ai.generate(brief,[]),(error:unknown)=>{
        assert.equal((error as {code?:string}).code,'LLM_SCHEMA_MISMATCH');
        assert.equal((error as {status?:number}).status,502);return true;
      });
    }
    assert.equal((await readdir(path.join(s.root,'drafts','prompts'))).length,0);
    assert.equal(await s.prompts.count(),0);
  }finally{await s.clean();}
});


test('PA01 检查先持久化；重写失败保留已检查草稿并可显式续做',async()=>{
 const s=await setup();try{const checkedWire={version:1,checks:checks.map(({id,status,evidence})=>({id,status,evidence})),improvements:checks.filter(x=>x.status==='missing').map(x=>({dimensionId:x.id,issue:'缺失',action:'补充'}))};s.setResponse(checkedWire);const checked=await s.ai.check('弱 Prompt','补充要求',undefined,undefined);assert.equal(checked.stage,'checked');const before=await s.ai.get(checked.draftId);assert.equal(before?.stage,'checked');assert.equal(before?.preview,undefined);s.setRaw('{broken');await assert.rejects(()=>s.ai.rewrite(checked.draftId,crypto.randomUUID()));const failed=await s.ai.get(checked.draftId);assert.equal(failed?.stage,'failed');assert.equal(failed?.originalBody,'弱 Prompt');assert.equal(failed?.checks?.length,9);assert.equal(failed?.attempts,1);s.setResponse(content);const ready=await s.ai.rewrite(checked.draftId,crypto.randomUUID()) as {stage:string};assert.equal(ready.stage,'ready');assert.equal((await s.ai.get(checked.draftId))?.attempts,2);}finally{await s.clean();}
});

test('PA01 R1 malformed submitted Brief is rejected as user input before any provider call',async()=>{
 const s=await setup();try{const before=s.requests.length;for(const invalid of [{...brief,goal:''},{...brief,context:[]}])await assert.rejects(()=>s.ai.generate(invalid,[]),(error:unknown)=>{const e=error as {code?:string;status?:number;details?:{category?:string;stage?:string;retryable?:boolean;nextAction?:string}};assert.equal(e.code,'LLM_SCHEMA_MISMATCH');assert.equal(e.status,400);assert.equal(e.details?.category,'user_input');assert.equal(e.details?.stage,'generate');assert.equal(e.details?.retryable,false);assert.equal(e.details?.nextAction,'review_input');return true;});assert.equal(s.requests.length,before,'invalid user Brief must cause zero provider calls');assert.equal(await s.prompts.count(),0);}finally{await s.clean();}
});