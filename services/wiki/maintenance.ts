import {assertReviewStructure} from './human-review.ts';
import {createHash} from 'node:crypto';
import type {WikiRecord} from './store.ts';
import type {KnowledgeDraftRecord as DraftRecord} from './drafts.ts';

export type KnowledgeChange = {
  changeId:string; pageIndex:number; pageIndexes?:number[]; action:'create'|'update'|'link'|'noop';
  targetWikiId?:string; baseRevision?:number;
  candidate:Pick<WikiRecord,'title'|'type'|'category'|'body'|'aliases'|'tags'|'sources'|'knowledge_status'|'confidence'|'source_level'>;
  reason:string; summary:string[]; questions:string[]; dependsOn:string[];
  decision:'defer'|'accept'; committedOperationId?:string; approval?:{digest:string;at:string};
};
export const changePageIndexes=(change:KnowledgeChange)=>change.pageIndexes??[change.pageIndex];
export type KnowledgeMaintenance = {version:1; context:WikiRecord[]; changes:KnowledgeChange[]};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=256&&v.every(x=>typeof x==='string'&&x.length<=8000);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
export function validMaintenance(v:unknown):v is KnowledgeMaintenance {
  if(!object(v)||v.version!==1||!Array.isArray(v.context)||v.context.length>50||!Array.isArray(v.changes)||v.changes.length>50)return false;
  if(v.context.some((p:unknown)=>!object(p)||!uuid(p.id)||!Number.isInteger(p.revision)||p.revision<1||typeof p.body!=='string'||!strings(p.sources)))return false;
  const ids=new Set<string>(), topics=new Set<number>(), targets=new Set<string>();
  for(const c of v.changes){
    if(!object(c)||typeof c.changeId!=='string'||!/^[a-z0-9-]{1,64}$/.test(c.changeId)||ids.has(c.changeId)||!Number.isInteger(c.pageIndex)||c.pageIndex<0||!['create','update','link','noop'].includes(c.action)||!['defer','accept'].includes(c.decision)||typeof c.reason!=='string'||!c.reason.trim()||!strings(c.summary)||!strings(c.questions)||!strings(c.dependsOn)||!object(c.candidate))return false;
    const p=c.candidate;
    if(!['title','body'].every(k=>typeof p[k]==='string'&&p[k].trim())||p.title.length>300||p.body.length>100000||!['concept','entity','business_process','metric','synthesis'].includes(p.type)||!['industry_basics','category','channel','sales','store','distributor','supply_chain','product','metric','ai_application','company_business','customer','other'].includes(p.category)||!strings(p.aliases)||!strings(p.tags)||!strings(p.sources)||!p.sources.every(uuid)||!['verified','source_supported','ai_organized','inferred','needs_verification'].includes(p.knowledge_status)||!['high','medium','low'].includes(p.confidence)||!['A','B','C','D'].includes(p.source_level))return false;
    if(c.action==='create'?(c.targetWikiId!==undefined||c.baseRevision!==undefined):(!uuid(c.targetWikiId)||!Number.isInteger(c.baseRevision)||!v.context.some((p:WikiRecord)=>p.id===c.targetWikiId&&p.revision===c.baseRevision&&p.type!=='source')))return false;
    if(c.pageIndexes!==undefined&&(!Array.isArray(c.pageIndexes)||c.pageIndexes.length<1||c.pageIndexes.length>50||c.pageIndexes[0]!==c.pageIndex))return false;
    for(const index of c.pageIndexes??[c.pageIndex]){
      if(!Number.isInteger(index)||index<0||topics.has(index))return false;
      topics.add(index);
    }
    if(c.targetWikiId&&targets.has(c.targetWikiId))return false;
    if(c.targetWikiId)targets.add(c.targetWikiId);
    if(c.committedOperationId!==undefined&&!uuid(c.committedOperationId))return false;
    if(c.approval!==undefined&&(!object(c.approval)||typeof c.approval.digest!=='string'||!/^[a-f0-9]{64}$/.test(c.approval.digest)||typeof c.approval.at!=='string'))return false;
    ids.add(c.changeId);
  }
  return v.changes.every((c:KnowledgeChange)=>c.dependsOn.every(id=>ids.has(id)&&id!==c.changeId));
}
/** The entire editable proposal, source note and source catalog are covered, not just the title. */
export function maintenanceDigest(draft:DraftRecord,changeId?:string):string {
  const changes=draft.maintenance?.changes.filter(c=>changeId?c.changeId===changeId:c.decision==='accept'&&!c.committedOperationId).map(({approval:_approval,decision:_decision,committedOperationId:_operation,...c})=>({...c,evidence:c.pageIndexes?c.pageIndexes.map(index=>draft.pages[index]?.source_evidence):draft.pages[c.pageIndex]?.source_evidence}));
  return createHash('sha256').update(JSON.stringify({...('input' in draft?{input:draft.input}:{rawId:draft.rawId,rawSha256:draft.rawSha256}),...('input' in draft?{}:{source:draft.source}),note:draft.structuredNote,noteReview:draft.noteReview,humanQuestionUnitIds:draft.humanQuestionUnitIds,qualityReport:draft.qualityReport,review:draft.humanReview&&{basisDigest:draft.humanReview.basisDigest,units:draft.humanReview.units,assignments:draft.humanReview.assignments},changes})).digest('hex');
}
export function assertMaintenanceReviewed(draft:DraftRecord):string {
  const fail=(code:string,message:string):never=>{throw Object.assign(new Error(message),{code,status:409});};
  assertReviewStructure(draft.humanReview,draft.pages.map(p=>p.pageId));
  if(Object.values(draft.humanReview.assignments).some(id=>id===null))fail('HUMAN_REVIEW_INCOMPLETE','存在未归属的来源事实或问题，请先完成完整归属。');
  if(!validMaintenance(draft.maintenance))fail('MAINTENANCE_INVALID','知识变更草稿结构无效，原记录保留。');
  const maintenance=draft.maintenance!,accepted=maintenance.changes.filter(c=>c.decision==='accept'&&!c.committedOperationId),digest=maintenanceDigest(draft);
  if(!accepted.length)fail('NO_SELECTION','请至少接受一项知识变更。');
  for(const c of accepted){
    if(c.approval?.digest!==maintenanceDigest(draft,c.changeId))fail('CHANGE_REVIEW_REQUIRED','编辑后需重新确认每项接受的变更及来源笔记。');
    if(c.dependsOn.some(id=>!maintenance.changes.some(other=>other.changeId===id&&(other.committedOperationId||accepted.includes(other)))))fail('CHANGE_DEPENDENCY_REQUIRED','依赖项未被接受，请一并接受或暂缓本项。');
  }
  return digest;
}
