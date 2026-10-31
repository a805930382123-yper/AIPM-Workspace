import { createHash } from 'node:crypto';
import { PromptError } from './errors.ts';
import { isUuid } from './validate.ts';

export const FEEDBACK_OUTCOMES = ['helpful','needs_revision','not_applicable','unverified'] as const;
export type FeedbackOutcome = typeof FEEDBACK_OUTCOMES[number];
export type FeedbackInput = { usedOn:string; scenario:string; outcome:FeedbackOutcome; observation:string; nextImprovement:string };
export type Feedback = FeedbackInput & { id:string; promptId:string; promptVersion:number; revision:number; createdAt:string; updatedAt:string; creationHash:string };
export type FeedbackDto = Omit<Feedback,'creationHash'>;
export type FeedbackData = {schemaVersion:1;items:Feedback[];deletedIds:string[]};
const fields=['usedOn','scenario','outcome','observation','nextImprovement'];
const storedFields=[...fields,'id','promptId','promptVersion','revision','createdAt','updatedAt','creationHash'];
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const timestamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
function validFields(value:Record<string,unknown>) {return date(value.usedOn)&&typeof value.scenario==='string'&&value.scenario.trim().length>0&&value.scenario.trim().length<=200&&typeof value.outcome==='string'&&(FEEDBACK_OUTCOMES as readonly string[]).includes(value.outcome)&&typeof value.observation==='string'&&value.observation.length<=4000&&typeof value.nextImprovement==='string'&&value.nextImprovement.length<=4000;}
export function feedbackInput(value:unknown,mode:'create'|'update'):FeedbackInput & {id?:string;promptVersion?:number;baseRevision?:number} {
 const allowed=[...fields,...(mode==='create'?['id','promptVersion']:['baseRevision'])];
 if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key))||!validFields(value)||(mode==='create'? !isUuid(value.id)||!positive(value.promptVersion):!positive(value.baseRevision)))throw new PromptError('INVALID_FEEDBACK','反馈字段无效：请填写合法日期、场景、效果及长度范围；不可修改绑定身份或提交未知字段。',400);
 return {usedOn:value.usedOn as string,scenario:(value.scenario as string).trim(),outcome:value.outcome as FeedbackOutcome,observation:value.observation as string,nextImprovement:value.nextImprovement as string,...(mode==='create'?{id:value.id as string,promptVersion:value.promptVersion as number}:{baseRevision:value.baseRevision as number})};
}
export function feedbackDeleteInput(value:unknown):number {if(!object(value)||Object.keys(value).some(key=>key!=='baseRevision')||!positive(value.baseRevision))throw new PromptError('INVALID_FEEDBACK','删除反馈需要有效的baseRevision。',400);return value.baseRevision;}
/** Only the feedback boundary validates this optional data. Core Prompt reads keep it opaque. */
export function feedbackData(value:unknown,promptId:string,versions:number[]):FeedbackData {
 if(value===undefined)return {schemaVersion:1,items:[],deletedIds:[]};
 const corrupt=()=>{throw new PromptError('FEEDBACK_CORRUPT','使用反馈损坏或与Prompt版本不一致，原文件已保留；请检查记录或从备份恢复。',500);};
 if(!object(value)||Object.keys(value).some(key=>!['schemaVersion','items','deletedIds'].includes(key))||value.schemaVersion!==1||!Array.isArray(value.items)||!Array.isArray(value.deletedIds))return corrupt();
 const seen=new Set<string>();
 for(const entry of value.items){if(!object(entry)||Object.keys(entry).some(key=>!storedFields.includes(key))||!validFields(entry)||!isUuid(entry.id)||entry.promptId!==promptId||!positive(entry.promptVersion)||!versions.includes(entry.promptVersion)||!positive(entry.revision)||!timestamp(entry.createdAt)||!timestamp(entry.updatedAt)||typeof entry.creationHash!=='string'||!/^[a-f0-9]{64}$/.test(entry.creationHash)||seen.has(entry.id))return corrupt();seen.add(entry.id);}
 for(const id of value.deletedIds){if(!isUuid(id)||seen.has(id))return corrupt();seen.add(id);}
 return value as unknown as FeedbackData;
}
export function feedbackDto(value:Feedback):FeedbackDto {const {creationHash:_hash,...dto}=value;return structuredClone(dto);}
export function feedbackHash(promptId:string,promptVersion:number,input:FeedbackInput) {return createHash('sha256').update(JSON.stringify({promptId,promptVersion,usedOn:input.usedOn,scenario:input.scenario,outcome:input.outcome,observation:input.observation,nextImprovement:input.nextImprovement})).digest('hex');}
