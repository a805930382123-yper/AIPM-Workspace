import { buildKnowledgeAtoms } from './knowledge-atoms.ts';
import type { CheckpointChunk } from './checkpoints.ts';
import type { EvidenceLocator } from './locators.ts';
import { LlmError } from './provider.ts';

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
  return {facts,questions,sourceContexts:[...contexts.values()].sort((a,b)=>a.start-b.start||a.end-b.end)};
}

export const KNOWLEDGE_PLANNING_INSTRUCTION='facts/questions已经完成业务分类，规划阶段不得再次过滤。ID仅用于引用，其c编号是机械分块号，没有主题或主体含义；不得按chunk分组建页。根据sourceContexts中精确原文位置及有界上下文判断各记录的主体、时间、条件和口径，附近其它陈述只帮助定位，不能作为新增事实。sourceContexts中的factIds/questionIds是同一原文区间的全部独立输入记录，不是可选别名：跨chunk同源记录应归于同一业务主题，两个分栏分别完整保留；不同位置即使文本相同也不能视为一条而丢ID。未知、否定、未来建议、待确认口径和ambiguous事实也必须归入有事实支撑的相关主题；同一原文在facts与questions同时出现时，两种ID必须分别进入factIds与questionIds，不可二选一。输出前逐项核对全部输入fact/question ID恰好各出现一次；不能用问题ID替代事实ID，不能因不单独建页而省略记录。';
