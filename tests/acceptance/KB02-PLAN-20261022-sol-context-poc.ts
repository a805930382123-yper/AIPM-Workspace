import { buildKnowledgeAtoms } from '../../services/llm/knowledge-atoms.ts';
import { buildEvidenceLocatorCatalog } from '../../services/llm/locators.ts';
import { chunkText } from '../../services/llm/chunk.ts';
import type { ExtractionCheckpoint } from '../../services/llm/checkpoints.ts';

// Diagnosis-only candidate. No business keywords, source edits, record filtering or response repair.
export function candidatePlanningInput(body: string, cp: ExtractionCheckpoint) {
  const atomsByChunk = new Map(chunkText(body,{maxChunkChars:8000,overlap:400,maxRawChars:500000}).map(chunk=>[chunk.index,new Map(buildKnowledgeAtoms(body,buildEvidenceLocatorCatalog(body,chunk)).map(atom=>[atom.id,atom]))]));
  type Context = { id:string; start:number; end:number; contextStart:number; contextEnd:number; text:string; factIds:string[]; questionIds:string[] };
  const contexts = new Map<string,Context>();
  const records = (key:'facts'|'questions') => cp.completedChunks.flatMap(part=>part[key].map(item=> {
    const atom=atomsByChunk.get(part.index)?.get(item.atomId!);
    if(!atom || atom.text!==item.text || body.slice(atom.start,atom.end)!==item.text)throw Error('Unresolved exact atom');
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

export const candidatePlannerInstruction='facts/questions已经完成业务分类，规划阶段不得再次过滤。ID仅用于引用，其c编号是机械分块号，没有主题或主体含义；不得按chunk分组建页。根据sourceContexts中精确原文位置及有界上下文判断各记录的主体、时间、条件和口径，附近其它陈述只帮助定位，不能作为新增事实。sourceContexts中的factIds/questionIds是同一原文区间的全部独立输入记录，不是可选别名：跨chunk同源记录应归于同一业务主题，两个分栏分别完整保留；不同位置即使文本相同也不能视为一条而丢ID。未知、否定、未来建议、待确认口径和ambiguous事实也必须归入有事实支撑的相关主题；同一原文在facts与questions同时出现时，两种ID必须分别进入factIds与questionIds，不可二选一。输出前逐项核对全部输入fact/question ID恰好各出现一次；不能用问题ID替代事实ID，不能因不单独建页而省略记录。';
