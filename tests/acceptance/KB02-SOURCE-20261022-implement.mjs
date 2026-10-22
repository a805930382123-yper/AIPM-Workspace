import fs from 'node:fs/promises';
const file='services/llm/knowledge-planning.ts';let s=await fs.readFile(file,'utf8');
s=s.replace("import type { CheckpointChunk }", "import type { CheckpointChunk, KnowledgePlan }");
s=s.replace('return {facts,questions,sourceContexts:',`const units = (items: typeof facts | typeof questions, column: 'facts'|'questions') => {
    const grouped = new Map<string, PlanningUnit>();
    for (const item of items) {
      const kind = 'kind' in item ? item.kind : undefined;
      const key = JSON.stringify([item.sourceId, item.text, column, kind]);
      let unit = grouped.get(key);
      if (!unit) {
        unit = { id: (column === 'facts' ? 'fu' : 'qu')+'-'+item.sourceId.slice(2)+(kind ? '-'+kind : ''), sourceId: item.sourceId, text: item.text, ...(kind ? {kind} : {}), memberIds: [] };
        grouped.set(key, unit);
      }
      unit.memberIds.push(item.id);
    }
    return [...grouped.values()];
  };
  return {facts,questions,factUnits:units(facts,'facts'),questionUnits:units(questions,'questions'),sourceContexts:`);
s=s.slice(0,s.indexOf('export const KNOWLEDGE_PLANNING_INSTRUCTION'))+`export type PlanningUnit = { id:string; sourceId:string; text:string; kind?:'fact'|'ambiguous'; memberIds:string[] };
export type KnowledgePlanningInput = ReturnType<typeof buildKnowledgePlanningInput>;
export type KnowledgeWirePlan = { version:3; document:Omit<KnowledgePlan['document'],'summary'>; pages:Array<{ title:string; type:string; category:string; factUnitIds:string[]; questionUnitIds:string[] }> };

/** Called only after strict schema and unit coverage validation; never repairs missing references. */
export function expandKnowledgePlan(plan:KnowledgeWirePlan, input:KnowledgePlanningInput): KnowledgePlan['pages'] {
  const expand = (ids:string[], units:PlanningUnit[]) => ids.flatMap(id => {
    const unit=units.find(item=>item.id===id);
    if(!unit)throw new LlmError('LLM_PLAN_COVERAGE_INVALID','规划包含未知分配单元，未组装草稿。',502);
    return unit.memberIds;
  });
  return plan.pages.map(({factUnitIds,questionUnitIds,...page})=>({...page,factIds:expand(factUnitIds,input.factUnits),questionIds:expand(questionUnitIds,input.questionUnits)}));
}

/** Persisted plans contain original IDs. Every fixed member must occur exactly once on one page. */
export function projectKnowledgePlan(plan:KnowledgePlan, input:KnowledgePlanningInput):KnowledgeWirePlan {
  const owners = (units:PlanningUnit[], key:'factIds'|'questionIds') => new Map(units.map(unit=>{
    const assigned=unit.memberIds.map(id=>plan.pages.flatMap((page,index)=>page[key].filter(ref=>ref===id).map(()=>index)));
    const owner=assigned[0]?.[0];
    if(owner===undefined || assigned.some(pages=>pages.length!==1 || pages[0]!==owner))throw new LlmError('LLM_CHECKPOINT_CORRUPT','检查点等价记录分配不一致，已拒绝恢复。',409);
    return [unit.id,owner] as const;
  }));
  const facts=owners(input.factUnits,'factIds'),questions=owners(input.questionUnits,'questionIds');
  return {version:3,document:{title:plan.document.title,main_topic:plan.document.main_topic},pages:plan.pages.map((page,index)=>({title:page.title,type:page.type,category:page.category,factUnitIds:input.factUnits.filter(unit=>facts.get(unit.id)===index).map(unit=>unit.id),questionUnitIds:input.questionUnits.filter(unit=>questions.get(unit.id)===index).map(unit=>unit.id)}))};
}

export const KNOWLEDGE_PLANNING_INSTRUCTION='facts/questions已经完成业务分类，规划阶段不得再次过滤。ID仅用于引用，其c编号是机械分块号，没有主题或主体含义；不得按chunk分组建页。根据sourceContexts中精确原文位置及有界上下文判断各记录的主体、时间、条件和口径，附近其它陈述只帮助定位，不能作为新增事实。factUnits/questionUnits是唯一可分配单位，memberIds在发送前已固定；同一单位的所有原ID是等价重复记录，必须整体归于一个业务主题，不能拆开、删减或再次过滤。sourceContexts.factIds/questionIds及facts/questions只供逐字核对原记录；输出只引用unit.id，分别写入factUnitIds/questionUnitIds，不能输出原记录ID。不同位置即使文本相同也不是同一unit；同一位置不同kind、事实与问题是独立unit，可按实际业务主题分别归属，不可二选一。一个atom可能包含多个业务断言，但重复完整文本没有不同语义投影，不能把它们臆解成不同事实而拆页。相同主题跨chunk合并；保留主体、日期、条件、口径及数值，不能把相邻主体混到一页。未知、否定、未来建议、待确认口径和ambiguous事实也必须归入有事实支撑的相关主题。输出前逐项核对全部输入fact/question unit ID分别且恰好出现一次；不得遗漏、重复、添加未知ID或把事实unit写入问题分栏。';
`;
await fs.writeFile(file,s);
const schema=JSON.parse(await fs.readFile('rules/kb02-planning.schema.json','utf8'));schema.properties.version.enum=[3];const page=schema.properties.pages.items;page.required=page.required.map(k=>k==='factIds'?'factUnitIds':k==='questionIds'?'questionUnitIds':k);page.properties.factUnitIds=page.properties.factIds;page.properties.questionUnitIds=page.properties.questionIds;delete page.properties.factIds;delete page.properties.questionIds;await fs.writeFile('rules/kb02-planning.schema.json',JSON.stringify(schema,null,2)+'\n');
const rules='services/llm/rules.ts';await fs.writeFile(rules,(await fs.readFile(rules,'utf8')).replace('kb02-atoms-planning-7','kb02-atoms-planning-8'));
const extract='services/llm/knowledge-extraction.ts';s=await fs.readFile(extract,'utf8');s=s.replace('buildKnowledgePlanningInput, KNOWLEDGE_PLANNING_INSTRUCTION','buildKnowledgePlanningInput, expandKnowledgePlan, projectKnowledgePlan, KNOWLEDGE_PLANNING_INSTRUCTION, type KnowledgeWirePlan');
s=s.replace("    try { exact({ version: 2, ...current.plan, document: { title: current.plan.document.title, main_topic: current.plan.document.main_topic } }, bundle.kb02PlanningSchema, '检查点整篇主题规划'); } catch { throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点规划不符合当前严格schema，已拒绝恢复。', 409); }\n",'');
const marker="    try { assertNoKnownSecret(current.plan, input.provider.secrets ?? []); }";
s=s.replace(marker,"    const planningInput=buildKnowledgePlanningInput(input.body,current.completedChunks,catalogByChunk);\n    try { exact(projectKnowledgePlan(current.plan,planningInput), bundle.kb02PlanningSchema, '检查点整篇主题规划'); } catch { throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点规划结构或等价记录归属不合法，已拒绝恢复。', 409); }\n"+marker);
s=s.replace("const rawPlan = parsed as { version: number; document: Omit<KnowledgePlan['document'], 'summary'>; pages: KnowledgePlan['pages'] };",'const wirePlan = parsed as KnowledgeWirePlan;');
s=s.replace('rawPlan.pages.some(page => [...page.factIds, ...page.questionIds]','wirePlan.pages.some(page => [...page.factUnitIds, ...page.questionUnitIds]');
s=s.replace('const diagnostic = coverageDiagnostic(factIds, questionIds, rawPlan.pages);',"const diagnostic = coverageDiagnostic(planningInput.factUnits.map(unit=>unit.id), planningInput.questionUnits.map(unit=>unit.id), wirePlan.pages.map(page=>({title:page.title,factIds:page.factUnitIds,questionIds:page.questionUnitIds}))); ");
s=s.replace('    assertNoKnownSecret(rawPlan,',"    const rawPlan = {document:wirePlan.document,pages:expandKnowledgePlan(wirePlan,planningInput)};\n    if(hasCoverageErrors(coverageDiagnostic(factIds,questionIds,rawPlan.pages)))throw new LlmError('LLM_PLAN_COVERAGE_INVALID','分配单元与原记录覆盖不一致，未组装草稿。',502);\n    assertNoKnownSecret(rawPlan,");
s=s.replace(', type KnowledgePlan }', ' }');
await fs.writeFile(extract,s);

