import { buildKnowledgeAtoms } from './knowledge-atoms.ts';
import type { CheckpointChunk, KnowledgePlan } from './checkpoints.ts';
import type { EvidenceLocator } from './locators.ts';
import { LlmError } from './provider.ts';
import { templateSections, type TemplateFieldKey } from '../wiki/template-fields.ts';

// Content-neutral, exact Raw context for the already validated planning records.
// Source positions link overlapping records without removing either ID.
export function buildKnowledgePlanningInput(body: string, completedChunks: CheckpointChunk[], catalogs: Map<number, EvidenceLocator[]>) {
  const atomsByChunk = new Map(completedChunks.map(part=>[part.index,new Map(buildKnowledgeAtoms(body,catalogs.get(part.index) ?? []).map(atom=>[atom.id,atom]))]));
  type Context = { id:string; start:number; end:number; contextStart:number; contextEnd:number; text:string; factIds:string[]; questionIds:string[] };
  const contexts = new Map<string,Context>();
  const records = (key:'facts'|'questions') => completedChunks.flatMap(part=>part[key].map(item=> {
    const atom=atomsByChunk.get(part.index)?.get(item.atomId!);
    if(!atom || atom.text!==item.text || body.slice(atom.start,atom.end)!==item.text)throw new LlmError('LLM_CHECKPOINT_CORRUPT', '规划记录无法对应精确原文位置，已拒绝规划。', 409);
    const sourceId=`s-${atom.start}-${atom.end}`;
    let context=contexts.get(sourceId);
    if(!context) {
      let a=Math.max(0,atom.start-256),b=Math.min(body.length,atom.end+128);
      if(a>0 && /[\uDC00-\uDFFF]/u.test(body[a]) && /[\uD800-\uDBFF]/u.test(body[a-1]))a--;
      if(b<body.length && /[\uDC00-\uDFFF]/u.test(body[b]) && /[\uD800-\uDBFF]/u.test(body[b-1]))b++;
      context={id:sourceId,start:atom.start,end:atom.end,contextStart:a,contextEnd:b,text:body.slice(a,b),factIds:[],questionIds:[]};
      contexts.set(sourceId,context);
    }
    context[key==='facts'?'factIds':'questionIds'].push(item.id);
    return {id:item.id,text:item.text,...('kind' in item?{kind:item.kind}:{}),sourceId};
  }));
  const facts=records('facts'),questions=records('questions');
  const units = (items: typeof facts | typeof questions, column: 'facts'|'questions') => {
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
  return {facts,questions,factUnits:units(facts,'facts'),questionUnits:units(questions,'questions'),sourceContexts:[...contexts.values()].sort((a,b)=>a.start-b.start||a.end-b.end)};
}

export type PlanningUnit = { id:string; sourceId:string; text:string; kind?:'fact'|'ambiguous'; memberIds:string[] };
export type KnowledgePlanningInput = ReturnType<typeof buildKnowledgePlanningInput>;

/** Transport projection only. Internal review/persistence keeps every original context text. */
export function buildKnowledgePlanningWire(body: string, input: KnowledgePlanningInput) {
  const ranges: { start:number; end:number }[] = [];
  for (const context of [...input.sourceContexts].sort((a,b)=>a.contextStart-b.contextStart||a.contextEnd-b.contextEnd)) {
    const previous = ranges.at(-1);
    if (previous && context.contextStart <= previous.end) previous.end = Math.max(previous.end, context.contextEnd);
    else ranges.push({ start:context.contextStart, end:context.contextEnd });
  }
  const passages = ranges.map(({start,end})=>({id:`p-${start}-${end}`,start,end,text:body.slice(start,end)}));
  return { ...input, sourceContexts:input.sourceContexts.map(({text: _text,...context})=>({
    ...context, passageId:passages.find(p=>p.start<=context.contextStart&&p.end>=context.contextEnd)!.id,
  })), passages };
}

export const KNOWLEDGE_PLANNING_CONTEXT_INSTRUCTION = 'sourceContexts按id与unit.sourceId对应，保留atom的绝对start/end和原窗口的绝对contextStart/contextEnd。窗口文字不再重复携带：先按passageId找到passages中的原文片段，再取passage.text.slice(contextStart-passage.start,contextEnd-passage.start)无损恢复该unit原有的有界上下文；所有offset均为原文UTF-16位置。passages只去重传输重叠或相邻文字，不扩大任何unit的原窗口和证据；仅以原精确陈述及恢复的原窗口判断主体、年份、条件、单位、否定与未知，不能把整passage内其它陈述归给每个unit，不能引用原窗口外文字补充事实。';

export type KnowledgeWirePlan = { version:3; document:Omit<KnowledgePlan['document'],'summary'>; pages:Array<{ title:string; type:string; category:string; factUnitIds:string[]; questionUnitIds:string[]; templateFields?: Partial<Record<TemplateFieldKey, { text: string; factUnitIds: string[] }>> }> };

/** Called only after strict schema and unit coverage validation; never repairs missing references. */
export function expandKnowledgePlan(plan:KnowledgeWirePlan, input:KnowledgePlanningInput): KnowledgePlan['pages'] {
  const expand = (ids:string[], units:PlanningUnit[]) => ids.flatMap(id => {
    const unit=units.find(item=>item.id===id);
    if(!unit)throw new LlmError('LLM_PLAN_COVERAGE_INVALID','规划包含未知分配单元，未组装草稿。',502);
    return unit.memberIds;
  });
  return plan.pages.map(({factUnitIds,questionUnitIds,templateFields,...page})=> {
    const fields: NonNullable<KnowledgePlan['pages'][number]['templateFields']> = {};
    for (const [key, field] of Object.entries(templateFields ?? {})) {
      if (!templateSections(page.type).some(section => section.key === key) || new Set(field.factUnitIds).size !== field.factUnitIds.length || field.factUnitIds.some(id => !factUnitIds.includes(id))) throw new LlmError('LLM_PLAN_FIELD_INVALID', 'AI字段必须引用当前类型和当前页面的事实单元，未保存规划。', 502);
      fields[key as TemplateFieldKey] = { text: field.text, factIds: expand(field.factUnitIds, input.factUnits) };
    }
    return {...page,factIds:expand(factUnitIds,input.factUnits),questionIds:expand(questionUnitIds,input.questionUnits),...(templateFields !== undefined ? {templateFields:fields} : {})};
  });
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
  return {version:3,document:{title:plan.document.title,main_topic:plan.document.main_topic,...(plan.document.source_level ? {source_level:plan.document.source_level} : {})},pages:plan.pages.map((page,index)=>{
    const fields: NonNullable<KnowledgeWirePlan['pages'][number]['templateFields']> = {};
    for (const [key, field] of Object.entries(page.templateFields ?? {})) {
      if (!templateSections(page.type).some(section => section.key === key) || !field.factIds.length || new Set(field.factIds).size !== field.factIds.length || field.factIds.some(id => !page.factIds.includes(id))) throw new LlmError('LLM_CHECKPOINT_CORRUPT', 'AI字段包含类型错误或跨页事实引用，已拒绝恢复。', 409);
      const units = input.factUnits.filter(unit => unit.memberIds.some(id => field.factIds.includes(id)));
      if (units.some(unit => unit.memberIds.some(id => !field.factIds.includes(id))) || field.factIds.some(id => !units.some(unit => unit.memberIds.includes(id)))) throw new LlmError('LLM_CHECKPOINT_CORRUPT', 'AI字段未保留完整原事实单元，已拒绝恢复。', 409);
      fields[key as TemplateFieldKey] = {text:field.text,factUnitIds:units.map(unit=>unit.id)};
    }
    return {title:page.title,type:page.type,category:page.category,factUnitIds:input.factUnits.filter(unit=>facts.get(unit.id)===index).map(unit=>unit.id),questionUnitIds:input.questionUnits.filter(unit=>questions.get(unit.id)===index).map(unit=>unit.id),...(page.templateFields !== undefined ? {templateFields:fields} : {})};
  })};
}

export const KNOWLEDGE_TEMPLATE_FIELD_INSTRUCTION = [
  '对concept/business_process页在同一规划响应中按语义填写可选templateFields。字段名使用下列当前类型目录；其它类型不要输出字段。',
  '页面对象仅可包含title、type、category、factUnitIds、questionUnitIds和可选templateFields。所有模板栏目内容都必须放在templateFields内部，包含metrics、related_knowledge；不得把任何模板栏目放到页面顶层。',
  JSON.stringify(Object.fromEntries(['concept','business_process'].map(type=>[type,templateSections(type)]))),
  'templateFields只能选当前page.type目录中的键。完整schema列出的是多类型字段并集，不代表单页可混用；例如business_process不能输出definition。事实仍保留在本页factUnitIds中，不为套栏目改写或丢弃事实。',
  '每项只能包含text和factUnitIds。factUnitIds只引用本页factUnitIds中支持该字段的完整事实单元，允许同一事实为多个相关字段提供依据；字段引用不改变事实/问题的唯一页面归属。text是独立AI整理草稿，不是原事实、用户说明或用户归位。保持主体、条件、否定、未来及未知限定；不能把来源未知补成确定内容。没有足够依据时省略该字段，不能凭标题或关键词机械填充，不要用页标题充当概念解释。',
  '每项text的每个事实性断言，必须由该项所引factUnitIds支持。仅仅同属本页、同主题或上下文相邻不构成支持。原文明示未知若只在questionUnits中，将它归属本页questionUnitIds即可；没有相应支持事实时省略该栏目，程序会把原问题显示在待确认问题中。不得为填满栏目借用无关fact，也不得将question ID填入factUnitIds。资料没有给出指标等内容时省略相应栏目；ai_opportunities仍按既有分析建议边界处理。',
  '各字段整理必须保留来源所述的动作阶段与结果口径：申请、计划、安排或待执行，不等于已经执行、完成、生效或取得效果。流程规则、预期产物与某次事件实际结果应保持区分，不得只因栏目名为outputs就把步骤改写成已实现结果。仅整理所引事实明确支持的产物或安排；没有足够依据时省略字段，不为填满栏目补写完成或交付。',
  '以下抽象正反例互相独立，不是资料答案或页数要求，示例ID不是当前输入ID，真实输出只能使用输入的unit.id：有来源支持的指标放page.templateFields.metrics={text,factUnitIds}，page.metrics={...}非法；无指标依据时省略metrics，不生成建议指标占位。Concept的definition仅可在Concept页，Process使用其目录中的steps等键；定义事实若属于流程背景仍保留在该页factUnitIds，不能跨型填definition或机械改名。若qu-Q是“某审批负责人未知”、fu-A是“某AI尚未实施”，合法为本页questionUnitIds:["qu-Q"]并省略无事实支持的exceptions；exceptions写负责人未知却引用["fu-A"]非法。',
  'concept的一句话解释应独立说明概念含义；流程字段应分别表达实际目标、角色、触发、输入、步骤、输出等对应含义。ai_opportunities.text只能是分析建议，必须保留未实施/效果未知等原文边界，引用相关事实作为分析背景，不能宣称建议已经发生或有效。原文明示未知继续归属questionUnitIds，或保留原ambiguous事实与待确认说明；不要为填满栏目编造内容。所有字段仍需用户逐页审查，缺项可以保持待确认。',
].join('\n');

export const KNOWLEDGE_PLANNING_INSTRUCTION='facts/questions已经完成业务分类，规划阶段不得再次过滤。ID仅用于引用，其c编号是机械分块号，没有主题或主体含义；不得按chunk分组建页。先逐个unit依据sourceContexts中与其sourceId对应的精确原文位置及有界上下文，识别原文明确的主体、时间、条件和口径；相同字面内容不能覆盖主体差异。附近其它陈述只帮助定位，不能作为新增事实。然后在该主体口径内判断是否有原文支持且可独立理解的业务主题，例如业务定义、实体、流程或指标；有独立依据的主题可单独建页。未知、否定、未上线、未来建议、待确认口径和ambiguous事实通常是相关业务对象的限制或待确认事项，应归入有事实支撑的相关主题，不因这些边界词单独建泛化页，也不得按关键词过滤。不同主体即使边界句字面相同，也必须保留各自归属；同主体、同口径、同主题可以跨chunk合并。一个主体可以有多个独立主题，不要求一主体一页或固定页数。原文确有独立定义、触发条件或流程的AI机制可作为独立主题，不得仅因其涉及未来或未知而禁止建页。抽象例：若两种不同渠道各自都有门店事实及相同措辞的负责人未知，两个未知分别跟随各自渠道主题；同一渠道、同一口径的事实分散在不同chunk仍可合并；若原文另有独立定义的告警机制、触发条件或流程，可单独建业务主题，即使其中说明AI尚未上线。factUnits/questionUnits是唯一可分配单位，memberIds在发送前已固定；同一单位的所有原ID是等价重复记录，必须整体归于一个业务主题，不能拆开、删减或再次过滤。sourceContexts.factIds/questionIds及facts/questions只供逐字核对原记录；输出只引用unit.id，分别写入factUnitIds/questionUnitIds，不能输出原记录ID。不同位置即使文本相同也不是同一unit；同一位置不同kind、事实与问题是独立unit，可按实际业务主题分别归属，不可二选一。一个atom可能包含多个业务断言，但重复完整文本没有不同语义投影，不能把它们臆解成不同事实而拆页。同位置的fact与question仍是独立unit；只有它们表达同一主题边界时，才归入同一承载事实主题，不改变其独立分配要求。最后在本次响应提交前，从每个页面反查所含unit的主体和口径是否由标题及其承载事实主题正确呈现；若候选页只因未知或未来类别聚合了不同主体的边界句，模型应在本次规划响应中调整unit归属并保留全部unit；这不指令程序在响应后自动搬移记录、删改记录或补写事实，也不发起重试。全部输入fact/question unit ID仍须分别且恰好出现一次；不得遗漏、重复、添加未知ID或把事实unit写入问题分栏。';
