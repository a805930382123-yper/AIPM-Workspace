import { createHash } from 'node:crypto';

/** Original records are immutable; assignments and user prose are separate. */
export type ReviewEvidence = { id: string; rawId: string; quote: string; start: number; end: number; chunkIndex: number };
export type ReviewUnit = {
  id: string; kind: 'fact' | 'question' | 'proposal'; origin: 'kb02' | 'legacy' | 'model'; text: string;
  memberIds: string[]; sourceId?: string; start?: number; end?: number; factKind?: 'fact' | 'ambiguous';
  records: Array<{ id: string; text: string; evidenceIds: string[] }>;
  evidence: ReviewEvidence[]; section?: string; sourceLabel?: string;
};
export type ReviewBasis = { units: ReviewUnit[]; pageUnitIds: string[][] };
export type HumanReview = {
  version: 1; units: ReviewUnit[]; basisDigest: string; assignments: Record<string, string | null>;
  approvals: Array<{ pageId: string; digest: string; at: string }>;
};
export class HumanReviewError extends Error {
  constructor(public code: string, message: string, public status = 409, public details?: unknown) { super(message); }
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const reviewBasisDigest = (units: ReviewUnit[]) => hash(units);

export function validHumanReview(value: unknown): value is HumanReview {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.units) || value.units.length > 4096 || !object(value.assignments) || !Array.isArray(value.approvals) || typeof value.basisDigest !== 'string') return false;
  if (value.units.some(u => !object(u) || typeof u.id !== 'string' || !u.id || !['fact','question','proposal'].includes(u.kind) || !['kb02','legacy','model'].includes(u.origin) || typeof u.text !== 'string' || !strings(u.memberIds) || !Array.isArray(u.records) || u.records.some((r: unknown) => !object(r) || typeof r.id !== 'string' || typeof r.text !== 'string' || !strings(r.evidenceIds)) || !Array.isArray(u.evidence) || u.evidence.some((e: unknown) => !object(e) || typeof e.id !== 'string' || typeof e.rawId !== 'string' || typeof e.quote !== 'string' || !Number.isSafeInteger(e.start) || !Number.isSafeInteger(e.end) || e.start < 0 || e.end <= e.start || e.quote.length !== e.end-e.start || !Number.isInteger(e.chunkIndex)))) return false;
  if (new Set(value.units.map(u=>u.id)).size !== value.units.length || value.basisDigest !== reviewBasisDigest(value.units)) return false;
  for(const u of value.units as ReviewUnit[]){
    if(new Set(u.memberIds).size!==u.memberIds.length||u.records.some(r=>r.evidenceIds.some(id=>!u.evidence.some(e=>e.id===id))))return false;
    if(u.origin==='kb02'&&(u.kind==='proposal'||u.records.length!==u.memberIds.length||u.records.some(r=>!u.memberIds.includes(r.id)||r.text!==u.text)||new Set(u.records.map(r=>r.id)).size!==u.memberIds.length||!Number.isSafeInteger(u.start)||!Number.isSafeInteger(u.end)||u.sourceId!==`s-${u.start}-${u.end}`||Number(u.end)-Number(u.start)!==u.text.length))return false;
  }
  if (Object.keys(value.assignments).length !== value.units.length || value.units.some(u => !Object.hasOwn(value.assignments,u.id) || !(value.assignments[u.id] === null || typeof value.assignments[u.id] === 'string'))) return false;
  return value.approvals.every(a => object(a) && typeof a.pageId === 'string' && typeof a.digest === 'string' && typeof a.at === 'string') && new Set(value.approvals.map(a=>a.pageId)).size === value.approvals.length;
}
export function newHumanReview(units: ReviewUnit[], owners: Record<string,string|null>): HumanReview {
  const review: HumanReview = {version:1,units:structuredClone(units),basisDigest:reviewBasisDigest(units),assignments:{...owners},approvals:[]};
  if (!validHumanReview(review)) throw new HumanReviewError('REVIEW_BASIS_INVALID','审查来源目录无效，原数据已保留。');
  return review;
}
export function assertReviewStructure(review: HumanReview | undefined, pageIds: string[]): asserts review is HumanReview {
  if (!review) throw new HumanReviewError('HUMAN_REVIEW_REQUIRED','请先明确开始逐页主题与归属审查。');
  if (!validHumanReview(review) || Object.values(review.assignments).some(id=>id!==null&&!pageIds.includes(id)) || review.approvals.some(a=>!pageIds.includes(a.pageId))) throw new HumanReviewError('HUMAN_REVIEW_INVALID','审查目录或归属损坏，已停止正式写入。');
}
export function reviewContentDigest(identity: unknown, content: unknown, review: HumanReview): string {
  return hash({identity,content,basisDigest:review.basisDigest,assignments:review.assignments});
}
export function assertHumanReviewed(review: HumanReview | undefined, pageIds: string[], digest: string): asserts review is HumanReview {
  assertReviewStructure(review,pageIds);
  const unresolved = review.units.filter(u=>review.assignments[u.id]===null).map(u=>u.id);
  const unreviewedPageIds = pageIds.filter(id=>!review.approvals.some(a=>a.pageId===id&&a.digest===digest));
  if (unresolved.length || unreviewedPageIds.length) throw new HumanReviewError('HUMAN_REVIEW_INCOMPLETE','全部候选页必须逐页确认主题与完整归属，且不能存在未解决项。',409,{unresolvedUnitIds:unresolved,unreviewedPageIds});
}
export function confirmHumanPage(review: HumanReview, pageIds: string[], input: {pageId:string;reviewContentDigest:string;confirmed:boolean}, digest: string) {
  assertReviewStructure(review,pageIds);
  if (!pageIds.includes(input.pageId)) throw new HumanReviewError('REVIEW_PAGE_UNKNOWN','审查页面不存在。');
  if (input.reviewContentDigest !== digest) throw new HumanReviewError('REVIEW_CONTENT_CHANGED','候选内容已变化，请刷新后重新审查。');
  review.approvals=review.approvals.filter(a=>a.pageId!==input.pageId);
  if (input.confirmed) review.approvals.push({pageId:input.pageId,digest,at:new Date().toISOString()});
}
export function moveHumanUnits(review: HumanReview, pageIds: string[], ids: string[], pageId: string|null) {
  assertReviewStructure(review,pageIds);
  if (!ids.length || new Set(ids).size!==ids.length || ids.some(id=>!review.units.some(u=>u.id===id)) || (pageId!==null&&!pageIds.includes(pageId))) throw new HumanReviewError('REVIEW_ASSIGNMENT_INVALID','请移动已知且不重复的完整 unit 到现存页面或未解决池。',400);
  if (ids.some(id=>review.assignments[id]!==pageId)) {for(const id of ids)review.assignments[id]=pageId;review.approvals=[];}
}

/** Exclude only lifecycle and approval metadata. Every writable candidate field is bound. */
export function candidateContent(record: object): unknown {
  const copy=structuredClone(record) as Record<string,unknown>;
  for(const key of ['humanReview','reviewView','reviewContentDigest','revision','createdAt','updatedAt','status','commitOperationId','confirmedAt','discardedAt','lastCommitError','committedWikiId','warnings'])delete copy[key];
  return copy;
}
export function assertReviewSources(review: HumanReview, raws: Array<{id:string;body:string;bodySha256:string}>) {
  for(const raw of raws)if(createHash('sha256').update(raw.body).digest('hex')!==raw.bodySha256)throw new HumanReviewError('RAW_CHANGED','原文实际内容与校验值不一致。');
  for(const unit of review.units){
    for(const e of unit.evidence){const raw=raws.find(r=>r.id===e.rawId);if(!raw||raw.body.slice(e.start,e.end)!==e.quote)throw new HumanReviewError('REVIEW_SOURCE_CHANGED','审查来源定位与当前原文不一致。');}
    if(unit.origin==='kb02'&&!raws.some(raw=>raw.body.slice(unit.start,unit.end)===unit.text))throw new HumanReviewError('REVIEW_SOURCE_CHANGED','原unit文本与原文位置不一致。');
  }
}
