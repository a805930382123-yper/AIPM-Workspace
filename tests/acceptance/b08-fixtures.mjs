// Independent deterministic Provider fixture. It proves request/contract wiring, never real AI quality.
export const dimensions=['goal','role','context','input','tasks','constraints','output','fact_inference','anti_fabrication'];
export const task='我要第一次和经销商负责人访谈，希望了解他们现在的订货业务流程，并判断哪些地方未来可能适合 AI。';
export const brief={taskName:'经销商首次访谈',taskType:'客户访谈',role:'快消行业产品经理',goal:'了解订货业务流程',context:'首次访谈，不了解客户内部数据',input:'负责人访谈记录',tasks:'梳理角色、订货步骤、痛点和AI机会',constraints:'不虚构经营数据；区分事实、推断和待确认问题',output:'访谈提纲、流程与待确认问题'};
export const input=(name,body,extra={})=>({name,category:'customer',scenario:'经销商访谈',body,inputRequirements:'提供访谈记录',outputRequirements:'流程和待确认问题',relatedWikiIds:[],examples:'访谈示例',tags:['验收','访谈'],favorite:false,...extra});
export const providerUser=w=>JSON.parse(w.messages.find(m=>m.role==='user').content);
export function reply(w){
 const u=providerUser(w);
 if('task' in u)return {...brief,taskName:u.task.includes('第二任务')?'第二任务 Brief':brief.taskName};
 if('brief' in u)return {preview:input('隔离生成预览',` 首行\n角色：${u.brief.role}\n目标：${u.brief.goal}\n约束：${u.brief.constraints}\n输入：{{客户名称}}\n背景：${(u.relatedWiki??[]).map(p=>p.excerpt).join('\n')}\n尾部 `,{relatedWikiIds:u.relatedWikiIds})};
 if('body' in u){
  const complete=u.body.startsWith('完整九维');
  const checks=dimensions.map(id=>({id,status:complete?'present':id==='goal'?'present':'missing',evidence:complete?'原文明确覆盖此项':id==='goal'?'原文提出业务分析目标':'原文未说明此维度'}));
  return {checks,improvements:checks.filter(c=>c.status==='missing').map(c=>({dimensionId:c.id,issue:`缺少${c.id}`,action:`补充${c.id}的具体要求`})),preview:input('隔离优化预览',` 原目标：${u.body}\n补充：${u.supplement}\n步骤：还原流程；说明待确认问题。\n不得虚构；区分事实和推断。 `,{relatedWikiIds:u.target?.relatedWikiIds??[]})};
 }
 throw Error('Unknown independent fixture request');
}
