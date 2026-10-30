import { createHash } from 'node:crypto';
import { LlmError, assertNoKnownSecret, describeUnparsable } from './provider.ts';
import { runKnowledgePipeline, validateKnowledgeCheckpoint, type KnowledgeRunInput } from './knowledge-extraction.ts';
import type { ExtractionCheckpoint } from './checkpoints.ts';
import { validStructuredNote, STRUCTURED_NOTE_LIMITS, type StructuredNote, type NoteAttribution, type NoteText } from '../wiki/structured-note.ts';

export const DEEP_VERSION = 'kb03-1';
export const deepCallLimit = (n: number) => 2 * n + 8;
type Scan = { version: 1; rawSha256: string; lines: { start: number; end: number; kind: 'heading'|'paragraph'|'list'|'table'|'blank' }[] };
export type DeepOutline = { version: 1; sections: { id: string; title: string; question: string; factIds: string[]; questionIds: string[] }[]; excluded: { kind: 'fact'|'question'; id: string; reason: string }[] };
type Finding = { severity: 'warning'|'error'; category: 'semantic'|'numeric'|'coverage'|'supplementary'|'structure'; sectionId: string|null; blockIndex: number|null; reason: string };
export type DeepQualityReport = { version: 1; deterministic: 'passed'; model: 'passed'|'warning'; findings: Finding[] };
export type DeepState = { version: 1; scan: Scan; outline?: DeepOutline; note?: StructuredNote; qualityReport?: DeepQualityReport };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown, required: string[], optional: string[] = []): v is Record<string, any> => object(v) && required.every(k=>Object.hasOwn(v,k)) && Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const text = (v: unknown, n=300) => typeof v==='string' && !!v.trim() && v.length<=n;
const ids = (v: unknown, n=256): v is string[] => Array.isArray(v)&&v.length<=n&&v.every(x=>text(x,160))&&new Set(v).size===v.length;
function fail(code: string, message: string): never {throw new LlmError(code,message,502);}

export function scanDeepStructure(body: string): Scan {
  let start=0;
  const lines: Scan['lines']=[];
  for(const line of body.match(/[^\n]*\n|[^\n]+$/g)??[]){
    const kind=!line.trim()?'blank':/^\s*#{1,6}\s/.test(line)?'heading':/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)?'list':line.includes('|')?'table':'paragraph';
    lines.push({start,end:start+line.length,kind});start+=line.length;
  }
  return {version:1,rawSha256:createHash('sha256').update(body).digest('hex'),lines};
}
export function validDeepOutline(v: unknown, cp: ExtractionCheckpoint): v is DeepOutline {
  if(!keys(v,['version','sections','excluded'])||v.version!==1||!Array.isArray(v.sections)||!v.sections.length||v.sections.length>32||!Array.isArray(v.excluded)||v.excluded.length>384)return false;
  const facts=cp.completedChunks.flatMap(c=>c.facts.map(f=>f.id)),questions=cp.completedChunks.flatMap(c=>c.questions.map(q=>q.id));
  if(v.sections.some((s:unknown)=>!keys(s,['id','title','question','factIds','questionIds'])||!text(s.id,160)||!text(s.title)||!text(s.question,8000)||!ids(s.factIds)||!ids(s.questionIds,128)))return false;
  if(new Set(v.sections.map(s=>s.id)).size!==v.sections.length||new Set(v.sections.map(s=>s.title.normalize('NFKC').trim().toLowerCase())).size!==v.sections.length)return false;
  if(v.excluded.some((e:unknown)=>!keys(e,['kind','id','reason'])||!['fact','question'].includes(e.kind)||!text(e.id,160)||!text(e.reason,2000)))return false;
  return ([['fact',facts,'factIds'],['question',questions,'questionIds']] as const).every(([kind,all,key])=>{
    const assigned=[...v.sections.flatMap((s:DeepOutline['sections'][number])=>s[key]),...v.excluded.filter((e:DeepOutline['excluded'][number])=>e.kind===kind).map((e:DeepOutline['excluded'][number])=>e.id)];
    return assigned.length===all.length&&new Set(assigned).size===all.length&&assigned.every(id=>all.includes(id));
  });
}
export function validDeepQuality(v: unknown, note: StructuredNote): v is DeepQualityReport {
  return validDeepQualityLocations(v,note.sections.map(s=>({id:s.id,blockCount:s.blocks.length})));
}
export function validDeepQualityLocations(v:unknown,sections:{id:string;blockCount:number}[]):v is DeepQualityReport {
  return keys(v,['version','deterministic','model','findings'])&&v.version===1&&v.deterministic==='passed'&&['passed','warning'].includes(v.model)&&validFindings(v.findings,sections)&&v.model===(v.findings.length?'warning':'passed');
}
function validFindings(v: unknown, sections:{id:string;blockCount:number}[]): v is Finding[] {
  return Array.isArray(v)&&v.length<=128&&v.every(f=>keys(f,['severity','category','sectionId','blockIndex','reason'])&&['warning','error'].includes(f.severity)&&['semantic','numeric','coverage','supplementary','structure'].includes(f.category)&&text(f.reason,2000)&&(f.sectionId===null||sections.some(s=>s.id===f.sectionId))&&(f.blockIndex===null||(Number.isInteger(f.blockIndex)&&f.blockIndex>=0&&sections.some(s=>s.id===f.sectionId&&f.blockIndex<s.blockCount))));
}
/** Leaves own their source role; containers never claim independent evidence. */
export function deepLeaves(note: StructuredNote) {
  return note.sections.flatMap(s=>s.blocks.flatMap((b,blockIndex)=>{
    const leaves: (NoteAttribution&{prose:string})[]=b.type==='list'?b.items.map(i=>({...i,prose:i.text})):b.type==='table'?b.rows.map(r=>({...r,prose:r.cells.join(' ')})):b.type==='path_diagram'?[...b.nodes.map(n=>({...n,prose:n.text})),...b.edges.map(e=>({...e,prose:e.text}))]:[{...b,prose:b.text}];
    return leaves.map(l=>({...l,sectionId:s.id,blockIndex}));
  }));
}
const numbers = (v:string) => v.match(/[+-]?\d+(?:[.,]\d+)*(?:%|％|万元|亿元|万家|千克|公斤|毫升|家|元|吨|箱|件|个|人|天|月|年|日|小时|分钟|米|升|克)?/g)??[];
export function inspectEditedNote(note:StructuredNote,facts:Map<string,string>):string[]{
  const warnings:string[]=[];const leaves=deepLeaves(note);
  for(const leaf of leaves){if(leaf.role==='source_supported'||leaf.role==='reorganized'){const allowed=new Set(leaf.factIds.flatMap(id=>numbers(facts.get(id)??'')));if(numbers(leaf.prose).some(n=>!allowed.has(n)))warnings.push(`${leaf.sectionId} 第${leaf.blockIndex+1}块：数值或单位不受所选事实支持，人工修改待核对。`);}}
  if(leaves.filter(l=>l.role==='supplementary').length>leaves.length*.2)warnings.push('补充知识比例超过20%，人工修改待核对。');
  return warnings;
}
/** Keep selected source boundaries visible without turning them into business facts. */
export function preserveDeepBoundaries(note:StructuredNote,outline:DeepOutline,cp:ExtractionCheckpoint):StructuredNote {
  const preserved=structuredClone(note),first=outline.sections[0].id;
  const required=cp.completedChunks.flatMap(chunk=>[
    ...(chunk.sourceNotes??[]).map(item=>({sectionId:first,item:{role:'needs_verification' as const,factIds:[],text:item.text,reason:`来源或材料说明，尚未独立核验；原句保留，不作为业务事实。atom ${item.atomId}；locator ${item.locatorIds.join('、')}`} })),
    ...chunk.facts.filter(f=>f.kind==='ambiguous').map(item=>{
      const section=outline.sections.find(s=>s.factIds.includes(item.id));
      return {sectionId:section?.id??first,item:{role:'needs_verification' as const,factIds:section?[item.id]:[],text:item.text,reason:`原文存在歧义或转录疑点，保留原句待核，不据此补写或纠正事实${section?'':'；此项虽未纳入大纲正文，疑点仍需核对'}。fact ${item.id}；atom ${item.atomId}；locator ${item.locatorIds.join('、')}`}};
    }),
  ]);
  const leaves=deepLeaves(note);
  for(const section of preserved.sections){
    const missing:NoteText[]=required.filter(r=>r.sectionId===section.id&&!leaves.some(l=>l.sectionId===r.sectionId&&l.role===r.item.role&&l.prose===r.item.text&&l.reason===r.item.reason&&JSON.stringify(l.factIds)===JSON.stringify(r.item.factIds))).map(r=>r.item);
    for(let i=0;i<missing.length;i+=STRUCTURED_NOTE_LIMITS.items)section.blocks.push({type:'list',items:missing.slice(i,i+STRUCTURED_NOTE_LIMITS.items)});
  }
  if(!validStructuredNote(preserved,new Set(cp.completedChunks.flatMap(c=>c.facts.map(f=>f.id)))))fail('LLM_DEEP_BOUNDARY_CAPACITY','来源或歧义待核说明超出笔记现有容量，未截断或丢弃，未保存笔记。');
  return preserved;
}
export function checkDeepNote(note: StructuredNote, outline: DeepOutline, cp: ExtractionCheckpoint): void {
  if(JSON.stringify(note.sections.map(s=>s.id))!==JSON.stringify(outline.sections.map(s=>s.id)))fail('LLM_DEEP_WRITING_INVALID','笔记章节ID或顺序不符合大纲。');
  const leaves=deepLeaves(note), used=new Set<string>(),facts=new Map(cp.completedChunks.flatMap(c=>c.facts.map(f=>[f.id,f.text] as const)));
  for(const leaf of leaves){
    const section=outline.sections.find(s=>s.id===leaf.sectionId)!;
    if(leaf.factIds.some(id=>!section.factIds.includes(id)))fail('LLM_DEEP_WRITING_INVALID','正文引用越过大纲章节或引用已排除事实。');
    leaf.factIds.forEach(id=>used.add(id));
    if(leaf.role==='supplementary'){
      if(numbers(leaf.prose).length||/(?:公司|集团|有限公司|排名|预测|明年|今年|去年|昨日|今日|明日|季度)/.test(leaf.prose))fail('LLM_DEEP_SUPPLEMENT_INVALID','补充知识含具体数据、公司、日期、排名或预测。');
    } else if(leaf.role==='source_supported'||leaf.role==='reorganized'){
      const allowed=new Set(leaf.factIds.flatMap(id=>numbers(facts.get(id)!)));
      if(numbers(leaf.prose).some(token=>!allowed.has(token)))fail('LLM_DEEP_NUMERIC_INVALID','正文数值、日期或单位不受该叶项引用事实支持。');
    }
  }
  if(leaves.filter(l=>l.role==='supplementary').length>leaves.length*.2)fail('LLM_DEEP_SUPPLEMENT_INVALID','补充知识叶项比例超过20%。');
  if(outline.sections.flatMap(s=>s.factIds).some(id=>!used.has(id)))fail('LLM_DEEP_WRITING_INVALID','正文遗漏大纲included事实引用。');
  if(JSON.stringify(preserveDeepBoundaries(note,outline,cp))!==JSON.stringify(note))fail('LLM_DEEP_BOUNDARY_MISSING','笔记遗漏已选来源说明或已识别歧义的可见待核原句，检查未通过。');
}
/** Strict persistence check, repeated semantic checks at the Raw boundary on resume. */
export function validDeepState(v: unknown, cp: ExtractionCheckpoint): v is DeepState {
  if(!keys(v,['version','scan'],['outline','note','qualityReport'])||v.version!==1||!keys(v.scan,['version','rawSha256','lines'])||v.scan.version!==1||v.scan.rawSha256!==cp.rawSha256||!Array.isArray(v.scan.lines)||v.scan.lines.length>30000)return false;
  let end=0;
  for(const line of v.scan.lines){if(!keys(line,['start','end','kind'])||line.start!==end||!Number.isInteger(line.end)||line.end<=end||line.end>30000||!['heading','paragraph','list','table','blank'].includes(line.kind))return false;end=line.end;}
  if(v.outline!==undefined&&(!cp.plan||!validDeepOutline(v.outline,cp)))return false;
  if(v.note!==undefined&&(!v.outline||!validStructuredNote(v.note,new Set(cp.completedChunks.flatMap(c=>c.facts.map(f=>f.id))))))return false;
  if(v.qualityReport!==undefined&&(!v.note||!validDeepQuality(v.qualityReport,v.note)))return false;
  return true;
}
export const deepMinimum = (cp: ExtractionCheckpoint) => cp.completedChunks.length+(cp.plan?1:0)+(cp.deep?.outline?1:0)+(cp.deep?.note?1:0)+(cp.deep?.qualityReport?1:0);
export const deepRemaining = (cp: ExtractionCheckpoint) => cp.chunks.length-cp.completedChunks.length+(cp.plan?0:1)+(cp.deep?.outline?0:1)+(cp.deep?.note?0:1)+(cp.deep?.qualityReport?0:1);
export async function validateDeepCheckpoint(input: Pick<KnowledgeRunInput,'raw'|'body'|'bodySha256'|'provider'|'rulesDir'|'checkpoint'>) {
  const cp=input.checkpoint;
  if(cp.pipelineVersion!==DEEP_VERSION||cp.mode!=='deep'||!validDeepState(cp.deep,cp)||JSON.stringify(cp.deep.scan)!==JSON.stringify(scanDeepStructure(input.body))||cp.attempts<deepMinimum(cp)||cp.attempts>deepCallLimit(cp.chunks.length))fail('LLM_CHECKPOINT_CORRUPT','深度检查点结构、扫描或计数不一致。');
  assertNoKnownSecret(cp.deep,input.provider.secrets);
  await validateKnowledgeCheckpoint(input);
  if(cp.deep.note)checkDeepNote(cp.deep.note,cp.deep.outline!,cp);
}

export async function runDeepPipeline(input: KnowledgeRunInput) {
  await validateDeepCheckpoint(input);
  const base=await runKnowledgePipeline(input);let cp=base.checkpoint;
  const save=async(deep:DeepState)=>{cp=await input.saveCheckpoint({...cp,deep,stage:'assembling',lastError:undefined});};
  const call=async(stage:string,payload:unknown,instruction:string)=>{
    cp=await input.beforeCall('planning');
    const response=await input.provider.complete({purpose:'knowledge',system:`KB03 ${stage}。仅输出严格JSON，不改写事实或引文。${instruction}`,user:JSON.stringify({stage,...payload as object}),timeoutMs:120000,maxOutputBytes:3*1024*1024,signal:input.signal});
    if(input.signal?.aborted)fail('LLM_CANCELLED','深度整理已取消。');
    if(Buffer.byteLength(response.text,'utf8')>3*1024*1024)fail('LLM_RESPONSE_TOO_LARGE','深度输出超过上限。');
    if(response.finishReason==='length')fail('LLM_OUTPUT_TRUNCATED','深度输出被截断。');
    let parsed:unknown;try{parsed=JSON.parse(response.text);}catch{throw new LlmError('LLM_INVALID_JSON','深度阶段返回非法JSON。',502,describeUnparsable(response.text,input.provider.secrets));}
    assertNoKnownSecret(parsed,input.provider.secrets);return parsed;
  };
  const facts=cp.completedChunks.flatMap(c=>c.facts),questions=cp.completedChunks.flatMap(c=>c.questions);
  const {id,title,sourceType,sourceName,author,publishedAt,url,tags}=input.raw;
  const context={source:{id,title,sourceType,sourceName,author,publishedAt,url,tags},sourceNotes:cp.completedChunks.flatMap(c=>c.sourceNotes??[]),evidence:cp.completedChunks.flatMap(c=>c.evidence)};
  const boundaryInstruction='source只含用户登记线索，作者、日期和链接并非外部核验结果，不能把摘录或拼接材料说成已核实单一作者全文。sourceNotes是独立非业务说明，禁止转成业务事实或创造业务页面；其中缺失图表、转载/摘录来源等重要限制应在笔记正文用needs_verification及reason保留，不能只在质量报告提及。事实中的疑似错字、语句不通、转录含糊或kind=ambiguous须保留原句并标待核，禁止凭常识静默纠正；不编造未提供的图表内容、作者或来源结论。';
  if(!cp.deep!.outline){
    const outline=await call('outline',{facts,questions,scan:cp.deep!.scan,...context},'输出{version:1,sections:[{id,title,question,factIds,questionIds}],excluded:[{kind:"fact|question",id,reason}]}。全部事实和问题各唯一归属章节或有理由排除；章节ID和标题唯一。'+boundaryInstruction);
    if(!validDeepOutline(outline,cp))fail('LLM_DEEP_OUTLINE_INVALID','深度大纲遗漏、重复、未知ID或结构非法。');
    await save({...cp.deep!,outline});
  }
  if(!cp.deep!.note){
    const output=await call('writing',{outline:cp.deep!.outline,facts,questions,...context},'输出唯一R1笔记{version:1,orientation,sections:[{id,title,question,blocks}]}。block五类paragraph(text/role/factIds)、list(items各text/role/factIds)、table(title/headings/rows各cells/role/factIds)、path_diagram(title/nodes各id/text/role/factIds、edges各from/to/text/role/factIds)、callout(title/text/role/factIds)。角色source_supported/reorganized必须有所属章节factIds；supplementary为空factIds且仅独立补充概念，不含具体公司/数据/日期/排名/预测，最多20%叶项；needs_verification需非空reason。所有included事实至少引用一次，excluded不引用。章节ID/顺序一致，不改变主体、条件、数值、日期或单位，未上线/未知保持。'+boundaryInstruction);
    if(!validStructuredNote(output,new Set(facts.map(f=>f.id))))fail('LLM_DEEP_WRITING_INVALID','笔记结构或事实引用非法。');
    const note=preserveDeepBoundaries(output,cp.deep!.outline!,cp);
    checkDeepNote(note,cp.deep!.outline!,cp);await save({...cp.deep!,note});
  }
  checkDeepNote(cp.deep!.note!,cp.deep!.outline!,cp);
  if(!cp.deep!.qualityReport){
    const output=await call('quality',{note:cp.deep!.note,outline:cp.deep!.outline,facts,questions,...context},'只读检查，禁止改正文。逐断言对照事实检查主体、条件、数值/单位、未知/否定、覆盖及补充边界。逐项核对sourceNotes的重要材料限制、缺图/缺表、摘录拼接声明是否实际进入笔记正文，疑似转录或ambiguous是否保留原句并待核，来源登记线索是否被误称为已核验。被大纲排除也不能掩盖已识别歧义；不能只因引用/evidence含原句就算正文已表达。遗漏或边界误表须给coverage/semantic发现，定位受影响sectionId/blockIndex；此自检不等于独立质量通过。输出{version:1,findings:[{severity:"warning|error",category:"semantic|numeric|coverage|supplementary|structure",sectionId:章节ID或null,blockIndex:从0开始或null,reason:非空文本}]}。无发现findings=[]。'+boundaryInstruction);
    if(!keys(output,['version','findings'])||output.version!==1||!validFindings(output.findings,cp.deep!.note!.sections.map(s=>({id:s.id,blockCount:s.blocks.length}))))fail('LLM_DEEP_QUALITY_INVALID','模型质量报告无效，检查未完成。');
    await save({...cp.deep!,qualityReport:{version:1,deterministic:'passed',model:output.findings.length?'warning':'passed',findings:output.findings}});
  }
  return {outcome:{...base.outcome,callCount:cp.attempts,rulesVersion:`${cp.rulesVersion}-${DEEP_VERSION}`,warnings:[...base.outcome.warnings,'深度笔记尚未开放正式确认；数值检查及模型只读报告不替代逐页人工核对主体、条件、未知和否定。']},checkpoint:cp};
}
