import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { clearStorageScanIssue, reportStorageIssue, scanJsonRecords, writeFileAtomic } from '../storage/files.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { assertNoKnownSecret, LlmError, sanitizeProviderText } from '../llm/provider.ts';
import type { WikiStore, WikiRecord } from '../wiki/store.ts';
import type { PromptStore } from '../prompt/store.ts';
import { normalizePromptInput, type PromptInput } from '../prompt/validate.ts';
import { PROMPT_LIMITS } from '../prompt/limits.ts';
import { PromptError } from '../prompt/errors.ts';
import { BRIEF_CONTRACT, BRIEF_FIELDS, BRIEF_LIMITS, contentContract, CONTENT_LIMITS, OPTIMIZATION_CONTRACT, renderSections } from './contract.ts';

export const TEMPLATES = [
  { id: 'industry_learning', label: '行业学习' }, { id: 'business_process', label: '业务流程分析' },
  { id: 'customer_interview', label: '客户访谈' }, { id: 'requirements', label: '需求分析' },
  { id: 'ai_solution', label: 'AI方案设计' }, { id: 'meeting_notes', label: '会议资料整理' }, { id: 'custom', label: '自定义任务' },
] as const;
export const CHECKS = [
  ['goal', '任务目标'], ['role', '角色'], ['context', '业务背景'], ['input', '输入资料'], ['tasks', '执行步骤'],
  ['constraints', '约束条件'], ['output', '输出格式'], ['fact_inference', '事实与推断'], ['anti_fabrication', '防止虚构'],
] as const;
export const BUDGETS = { task: 10_000, briefField: 10_000, briefTotal: 30_000, selectedWiki: 6, perWikiChars: 3_000, totalWikiChars: 12_000, body: 100_000, timeoutMs: 60_000, maxOutputBytes: 512 * 1024 } as const;
export type Brief = { taskName: string; taskType: string; role: string; goal: string; context: string; input: string; tasks: string; constraints: string; output: string };
export type Preview = PromptInput;
type CallDiagnostic={requestId:string;stage:string;startedAt:string;finishedAt:string;durationMs:number;status:'success'|'failed';finishReason:string|null;bytes:number;usage?:{promptTokens?:number;completionTokens?:number};category?:string};
type Draft = { calls?:CallDiagnostic[]; schemaVersion?: number; integritySha256?:string; targetSnapshotSha256?:string; id: string; kind: 'generator' | 'optimizer'; createdAt: string; status: 'pending' | 'confirmed'; stage?: 'checked'|'rewriting'|'ready'|'failed'; lastRequestId?:string; requestIds?:string[]; inputSha256?: string; rulesVersion?: string; providerIdentity?: string; attempts?: number; supplement?: string; lastError?: {category:string;retryable:boolean}; brief?: Brief; sourceTask?: string; wikiCandidateIds?: string[]; preview?: Preview; originalBody?: string; checks?: Check[]; improvements?: Improvement[]; targetPromptId?: string; baseVersion?: number; confirmed?: { requestId: string; mode: 'new' | 'version'; payloadHash: string; promptId: string; version: number } };
type Check = { id: string; label: string; status: 'present' | 'missing'; evidence: string };
type Improvement = { dimensionId: string; issue: string; action: string };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
function classifyProviderFailure(code:string):string{const c=code.toUpperCase();if(/ABORT|CANCEL/u.test(c))return 'cancelled';if(/TIMEOUT/u.test(c))return 'timeout';if(/AUTH|FORBIDDEN/u.test(c))return 'auth';if(/RATE|THROTTL/u.test(c))return 'rate_limit';if(/NETWORK|ECONN|FETCH/u.test(c)||c==='LLM_PROVIDER_ERROR')return 'network';if(/JSON|SCHEMA|TRUNCAT|EMPTY|OUTPUT/u.test(c))return 'response_invalid';if(/STORAGE|CORRUPT/u.test(c))return 'storage';return 'configuration';}
function isCallDiagnostic(value:unknown):value is CallDiagnostic{return isObject(value)&&text(value.requestId)&&text(value.stage)&&text(value.startedAt)&&text(value.finishedAt)&&Number.isFinite(value.durationMs)&&['success','failed'].includes(String(value.status))&&(value.finishReason===null||['stop','length','content_filter','tool_calls'].includes(String(value.finishReason)))&&Number.isFinite(value.bytes);}function fail(code:string,message:string,status=400,details?:unknown):never{throw new PromptError(code,message,status,details??{requestId:randomUUID(),stage:'validation',category:status>=500?'response_invalid':'user_input',retryable:false,nextAction:status>=500?'retry_stage':'review_input'});}
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : isObject(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';

function actualType(v:unknown){return v===null?'null':Array.isArray(v)?'array':typeof v;}
function contractIssues(value:unknown,schema:unknown,path='$'):Array<{path:string;expected:string;actualType:string}>{
 if(!isObject(schema))return [];const s=schema as Record<string,unknown>,out:Array<{path:string;expected:string;actualType:string}>=[];
 if('const'in s&&!Object.is(value,s.const))out.push({path,expected:`const ${String(s.const)}`,actualType:actualType(value)});
 if(Array.isArray(s.enum)&&!s.enum.includes(value))out.push({path,expected:'enum',actualType:actualType(value)});
 const type=s.type;if(type==='object'){if(!isObject(value)){out.push({path,expected:'object',actualType:actualType(value)});return out;}const required=Array.isArray(s.required)?s.required as string[]:[];for(const key of required)if(!(key in value))out.push({path:`${path}.${key}`,expected:'required',actualType:'missing'});const props=isObject(s.properties)?s.properties:{};for(const [key,item] of Object.entries(props))if(key in value)out.push(...contractIssues(value[key],item,`${path}.${key}`));if(s.additionalProperties===false)for(const key of Object.keys(value))if(!(key in props))out.push({path:`${path}.${key}`,expected:'no additional property',actualType:actualType(value[key])});}
 if(type==='integer'&&(!Number.isInteger(value)||typeof value!=='number'))out.push({path,expected:'integer',actualType:actualType(value)});
 if(type==='string'){if(typeof value!=='string'){out.push({path,expected:'string',actualType:actualType(value)});return out;}if(typeof s.pattern==='string'&&!new RegExp(s.pattern,'u').test(value))out.push({path,expected:'nonblank string',actualType:'string'});if(s.singleLine===true&&/[\r\n]/u.test(value))out.push({path,expected:'single line',actualType:'string'});if(typeof s.minLength==='number'&&value.length<s.minLength)out.push({path,expected:`string minLength ${s.minLength}`,actualType:'string'});if(typeof s.maxLength==='number'&&value.length>s.maxLength)out.push({path,expected:`string maxLength ${s.maxLength}`,actualType:'string'});}
 if(type==='array'){if(!Array.isArray(value)){out.push({path,expected:'array',actualType:actualType(value)});return out;}if(typeof s.minItems==='number'&&value.length<s.minItems)out.push({path,expected:`array minItems ${s.minItems}`,actualType:'array'});if(typeof s.maxItems==='number'&&value.length>s.maxItems)out.push({path,expected:`array maxItems ${s.maxItems}`,actualType:'array'});if(s.uniqueItems===true&&new Set(value.map(item=>typeof item==='string'?item.trim():stable(item))).size!==value.length)out.push({path,expected:'unique items after trim',actualType:'array'});if(s.items!==undefined)value.forEach((item,i)=>out.push(...contractIssues(item,s.items,`${path}[${i}]`)));if(typeof s.uniqueBy==='string'){const key=s.uniqueBy;const vals=value.map(x=>isObject(x)?x[key]:undefined);if(new Set(vals).size!==vals.length)out.push({path,expected:`unique by ${key}`,actualType:'array'});}}
 return out;
}
function assertContract(value:unknown,schema:unknown,label:string){const errors=contractIssues(value,schema).slice(0,50);if(errors.length)fail('LLM_SCHEMA_MISMATCH',`Provider 返回的${label} 字段或结构不符合共同契约。`,502,{requestId:randomUUID(),stage:label==='Brief'?'brief':label==='Prompt 内容'?'generate':'check',category:'response_invalid',retryable:true,errors,totalErrors:contractIssues(value,schema).length,nextAction:'retry_stage'});}
function validateBrief(raw:unknown,userInput=false):Brief{
 if(userInput){const errors=contractIssues(raw,BRIEF_CONTRACT);if(errors.length)fail('LLM_SCHEMA_MISMATCH','Brief 字段或结构无效。',400,{requestId:randomUUID(),stage:'generate',category:'user_input',retryable:false,errors:errors.slice(0,50),totalErrors:errors.length,nextAction:'review_input'});}else assertContract(raw,BRIEF_CONTRACT,'Brief');if(!isObject(raw))fail('LLM_SCHEMA_MISMATCH','Brief 结构无效。',userInput?400:502,userInput?{stage:'generate',category:'user_input',retryable:false,nextAction:'review_input'}:undefined);
 if(BRIEF_FIELDS.reduce((n,key)=>n+(raw[key] as string).length,0)>BRIEF_LIMITS.totalChars)fail('LLM_SCHEMA_MISMATCH',userInput?'Brief 超出总字符预算。':'Provider 返回的 Brief 超出总字符预算。',userInput?400:502,userInput?{requestId:randomUUID(),stage:'generate',category:'user_input',retryable:false,nextAction:'review_input'}:undefined);
 return raw as unknown as Brief;
}
function validateContent(raw:unknown,relatedWikiIds:string[],categories:string[]):Preview{
 const contract=contentContract(categories);const example={...(contract.example as Record<string,unknown>),category:categories[0]};assertContract(example,contract,'Prompt契约示例');assertContract(raw,contract,'Prompt 内容');if(!isObject(raw))fail('LLM_SCHEMA_MISMATCH','Provider 返回的 Prompt 内容结构无效。',502);
 const sections=raw.sections as Array<{heading:string;content:string}>;const body=renderSections(sections);if(body.length>CONTENT_LIMITS.body)fail('LLM_SCHEMA_MISMATCH','Prompt 正文超出长度上限。',502);
 try{return normalizePromptInput({name:raw.name,category:raw.category,scenario:raw.scenario,body,inputRequirements:raw.inputRequirements,outputRequirements:raw.outputRequirements,relatedWikiIds,examples:raw.examples,tags:raw.tags,favorite:false},categories);}catch{fail('LLM_SCHEMA_MISMATCH','Provider 返回的 Prompt 内容不符合 Library 字段、分类或长度规则。',502);}
}
function validateChecks(raw:unknown):Check[]{
 assertContract({version:1,checks:raw,improvements:[]},OPTIMIZATION_CONTRACT,'九维检查');const items=raw as Array<{id:string;status:'present'|'missing';evidence:string}>;const byId=new Map<string,Check>();
 for(const check of items){if(!check.evidence.trim())fail('LLM_SCHEMA_MISMATCH','检查证据不得为空白。',502);const label=CHECKS.find(([id])=>id===check.id)?.[1];if(!label||byId.has(check.id))fail('LLM_SCHEMA_MISMATCH','Provider 返回未知或重复的检查维度。',502);byId.set(check.id,{id:check.id,label,status:check.status,evidence:check.evidence});}
 return CHECKS.map(([id])=>byId.get(id)!);
}
function validateImprovements(raw:unknown,checks:Check[]):Improvement[]{
 assertContract({version:1,checks:checks.map(({id,status,evidence})=>({id,status,evidence})),improvements:raw},OPTIMIZATION_CONTRACT,'优化改进点');const items=raw as Improvement[];const ids=new Set<string>();
 return items.map(item=>{if(!item.issue.trim()||!item.action.trim()||ids.has(item.dimensionId))fail('LLM_SCHEMA_MISMATCH','Provider 返回的改进点字段无效。',502);if(!checks.some(check=>check.id===item.dimensionId&&check.status==='missing'))fail('LLM_SCHEMA_MISMATCH','改进点必须对应实际缺失维度。',502);ids.add(item.dimensionId);return {dimensionId:item.dimensionId,issue:item.issue,action:item.action};});
}const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exactKeys=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
function validPromptPreview(value:unknown):value is Preview{if(!isObject(value))return false;const keys=['name','category','scenario','body','inputRequirements','outputRequirements','relatedWikiIds','examples','tags','favorite'];if(Object.keys(value).length!==keys.length||!exactKeys(value,keys))return false;return text(value.name)&&!!value.name.trim()&&value.name.length<=PROMPT_LIMITS.name&&!/[\r\n]/u.test(value.name)&&text(value.category)&&!!value.category.trim()&&value.category.length<=100&&!/[\r\n]/u.test(value.category)&&text(value.scenario)&&value.scenario.length<=PROMPT_LIMITS.scenario&&text(value.body)&&!!value.body.trim()&&value.body.length<=PROMPT_LIMITS.body&&text(value.inputRequirements)&&value.inputRequirements.length<=PROMPT_LIMITS.inputRequirements&&text(value.outputRequirements)&&value.outputRequirements.length<=PROMPT_LIMITS.outputRequirements&&text(value.examples)&&value.examples.length<=PROMPT_LIMITS.examples&&Array.isArray(value.relatedWikiIds)&&value.relatedWikiIds.length<=PROMPT_LIMITS.relatedWikiIds&&value.relatedWikiIds.every(id=>text(id)&&UUID_RE.test(id))&&new Set(value.relatedWikiIds).size===value.relatedWikiIds.length&&Array.isArray(value.tags)&&value.tags.length<=PROMPT_LIMITS.tags&&value.tags.every(tag=>text(tag)&&!!tag.trim()&&tag.length<=PROMPT_LIMITS.tagChars)&&new Set(value.tags).size===value.tags.length&&typeof value.favorite==='boolean';}
function validChecks(checks:unknown):checks is Check[]{if(!Array.isArray(checks)||checks.length!==CHECKS.length)return false;try{const normalized=validateChecks(checks.map(({id,status,evidence})=>({id,status,evidence})));return stable(normalized)===stable(checks);}catch{return false;}}
function validImprovements(improvements:unknown,checks:Check[]):improvements is Improvement[]{if(!Array.isArray(improvements))return false;try{return stable(validateImprovements(improvements,checks))===stable(improvements);}catch{return false;}}
function validReceipt(value:unknown,legacy=false):boolean{return isObject(value)&&exactKeys(value,['requestId','mode','payloadHash','promptId','version'])&&text(value.requestId)&&UUID_RE.test(value.requestId)&&['new','version'].includes(String(value.mode))&&text(value.payloadHash)&&(/^[0-9a-f]{64}$/i.test(value.payloadHash)||(legacy&&(()=>{try{return isObject(JSON.parse(value.payloadHash))&&stable(JSON.parse(value.payloadHash))===value.payloadHash;}catch{return false;}})()))&&text(value.promptId)&&UUID_RE.test(value.promptId)&&Number.isInteger(value.version)&&Number(value.version)>0;}
function draftIntegrity(d:Draft){const copy={...d};delete copy.integritySha256;const normalized=JSON.parse(JSON.stringify(copy));return createHash('sha256').update(stable(normalized)).digest('hex');}
export function validStoredDraft(value:unknown,id:string):value is Draft {
 if(!isObject(value)||value.id!==id||!UUID_RE.test(id)||!['generator','optimizer'].includes(String(value.kind))||!['pending','confirmed'].includes(String(value.status))||!text(value.createdAt))return false;
 const d=value as unknown as Draft;
 const common=['id','kind','createdAt','status','schemaVersion','integritySha256','confirmed','calls'];
 if(d.schemaVersion!==undefined&&d.schemaVersion!==2)return false;
 const kindKeys=d.kind==='generator'?['brief','sourceTask','wikiCandidateIds','preview']:['stage','lastRequestId','requestIds','inputSha256','rulesVersion','providerIdentity','attempts','supplement','lastError','originalBody','checks','improvements','targetPromptId','baseVersion','wikiCandidateIds','targetSnapshotSha256','preview'];
 if(!exactKeys(value,[...common,...kindKeys]))return false;
 if(d.schemaVersion===2){if(!text(d.integritySha256)||d.integritySha256!==draftIntegrity(d))return false;if(d.calls!==undefined&&(!Array.isArray(d.calls)||!d.calls.every(call=>isObject(call)&&text(call.requestId)&&UUID_RE.test(call.requestId)&&text(call.stage)&&text(call.startedAt)&&text(call.finishedAt)&&Number.isFinite(call.durationMs)&&Number(call.durationMs)>=0&&['success','failed'].includes(String(call.status))&&[null,'stop','length','content_filter','tool_calls'].includes(call.finishReason as string|null)&&(call.bytes===undefined||Number.isFinite(call.bytes)))))return false;}
 if(d.kind==='generator'){try{validateBrief(d.brief);}catch{return false;}if(!isObject(d.brief)||!BRIEF_FIELDS.every(key=>text(d.brief?.[key]))||BRIEF_FIELDS.some(key=>(d.brief?.[key] as string).length>BRIEF_LIMITS.fieldChars)||BRIEF_FIELDS.reduce((n,key)=>n+(d.brief?.[key] as string).length,0)>BRIEF_LIMITS.totalChars||!text(d.sourceTask)||!Array.isArray(d.wikiCandidateIds)||d.wikiCandidateIds.length>100||!d.wikiCandidateIds.every(x=>text(x)&&UUID_RE.test(x))||new Set(d.wikiCandidateIds).size!==d.wikiCandidateIds.length)return false;if(d.preview!==undefined&&!validPromptPreview(d.preview))return false;if(d.status==='confirmed'&&(!d.preview||!validReceipt(d.confirmed)))return false;if(d.status==='pending'&&d.confirmed!==undefined)return false;return true;}
 if(d.schemaVersion===undefined){if(!text(d.originalBody)||!d.originalBody.trim()||d.originalBody.length>BUDGETS.body||!validPromptPreview(d.preview)||!validChecks(d.checks)||!validImprovements(d.improvements,d.checks))return false;if((d.targetPromptId===undefined)!==(d.baseVersion===undefined)||(d.targetPromptId!==undefined&&(!text(d.targetPromptId)||!UUID_RE.test(d.targetPromptId)||!Number.isInteger(d.baseVersion)||Number(d.baseVersion)<1)))return false;if(d.status==='confirmed'&&!validReceipt(d.confirmed,true))return false;if(d.status==='pending'&&d.confirmed!==undefined)return false;return true;}
 if(!['checked','rewriting','ready','failed'].includes(String(d.stage))||!text(d.originalBody)||!d.originalBody.trim()||d.originalBody.length>BUDGETS.body||!text(d.supplement)||d.supplement.length>BUDGETS.task||!validChecks(d.checks)||!validImprovements(d.improvements,d.checks)||!Number.isInteger(d.attempts)||Number(d.attempts)<0||Number(d.attempts)>3||!Array.isArray(d.requestIds)||!text(d.inputSha256)||!/^[0-9a-f]{64}$/i.test(d.inputSha256)||d.rulesVersion!=='pa01-1'||!text(d.providerIdentity)||!d.providerIdentity)return false;
 if(d.inputSha256!==createHash('sha256').update(d.originalBody+'\0'+d.supplement).digest('hex'))return false;
 if((d.targetPromptId===undefined)!==(d.baseVersion===undefined)||(d.targetPromptId!==undefined&&(!text(d.targetPromptId)||!UUID_RE.test(d.targetPromptId)||!Number.isInteger(d.baseVersion)||Number(d.baseVersion)<1||!Array.isArray(d.wikiCandidateIds)||!d.wikiCandidateIds.every(x=>text(x)&&UUID_RE.test(x))||new Set(d.wikiCandidateIds).size!==d.wikiCandidateIds.length||!text(d.targetSnapshotSha256)||!/^[0-9a-f]{64}$/i.test(d.targetSnapshotSha256)))||(d.targetPromptId===undefined&&((d.wikiCandidateIds?.length??0)!==0||d.targetSnapshotSha256!==undefined)))return false;
 if(new Set(d.requestIds).size!==d.requestIds.length||d.requestIds.some(x=>!text(x)||!UUID_RE.test(x))||d.attempts!==d.requestIds.length)return false;
 if(d.stage==='checked'&&(d.attempts!==0||d.lastRequestId!==undefined||d.preview!==undefined||d.lastError!==undefined))return false;
 if(['rewriting','failed','ready'].includes(d.stage??'')&&(d.attempts!<1||!text(d.lastRequestId)||!UUID_RE.test(d.lastRequestId)||d.requestIds.at(-1)!==d.lastRequestId))return false;
 if(d.stage==='ready'&&!validPromptPreview(d.preview))return false;if(d.stage!=='ready'&&d.preview!==undefined)return false;if(d.lastError!==undefined&&(!isObject(d.lastError)||!text(d.lastError.category)||typeof d.lastError.retryable!=='boolean'))return false;
 if(d.targetPromptId&&createHash('sha256').update(stable({id:d.targetPromptId,version:d.baseVersion,relatedWikiIds:d.wikiCandidateIds})).digest('hex')!==d.targetSnapshotSha256)return false;
 if(d.status==='confirmed'&&(!d.preview||!validReceipt(d.confirmed)))return false;if(d.status==='pending'&&d.confirmed!==undefined)return false;return true;
}export class PromptAiService {
  private readonly dir: string;
  private readonly root: string;
  constructor(root: string, private readonly wiki: WikiStore, private readonly prompts: PromptStore, private readonly provider: () => LlmProvider | undefined) { this.root=path.resolve(root);this.dir = path.join(root, 'drafts', 'prompts'); }
  async initialize() { await mkdir(this.dir, { recursive: true }); const scan=await scanJsonRecords<unknown>(this.dir,(v,file):v is unknown=>isObject(v)&&validStoredDraft(v,path.basename(file,'.json')),this.root); for(const record of scan.records){const d=record.value as Draft;if(record.file!==path.join(this.dir,`${d.id}.json`)){reportStorageIssue(this.root,record.file,'shape');continue;}try{assertNoKnownSecret(d,this.provider()?.secrets??[]);if(d.kind==='optimizer'&&d.stage==='rewriting'){d.stage='failed';d.lastError={category:'recovery',retryable:true};await this.save(d);}}catch{reportStorageIssue(this.root,record.file,'shape');}} }async schema() { const categories=(await this.prompts.schema()).categories.map(item=>item.id);assertContract(BRIEF_CONTRACT.example,BRIEF_CONTRACT,'Brief');assertContract(OPTIMIZATION_CONTRACT.example,OPTIMIZATION_CONTRACT,'九维检查示例');const content=contentContract(categories);assertContract(content.example,content,'Prompt契约示例');return { templates: TEMPLATES, checks: CHECKS.map(([id, label]) => ({ id, label })), budgets: BUDGETS, briefContract: BRIEF_CONTRACT, contentContract: content, optimizationContract: OPTIMIZATION_CONTRACT }; }
  private async save(draft: Draft) { draft.schemaVersion=2; delete draft.integritySha256; draft.integritySha256=draftIntegrity(draft); await writeFileAtomic(path.join(this.dir, `${draft.id}.json`), `${JSON.stringify(draft, null, 2)}\n`); return draft; }
  async get(id: string): Promise<Draft | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    let draft:unknown;const file=path.join(this.dir, `${id}.json`);try{const fh=await open(file,'r');try{const stat=await fh.stat();if(stat.size>2*1024*1024){reportStorageIssue(this.root,file,'read');throw new PromptError('STORAGE_CORRUPT','草稿记录超过单条读取上限，原文件已保留；请从备份恢复。',500,{category:'recovery',stage:'read',nextAction:'inspect_or_restore'});}const bytes=Buffer.alloc(stat.size);let pos=0;while(pos<bytes.length){const n=await fh.read(bytes,pos,bytes.length-pos,pos);if(!n.bytesRead)break;pos+=n.bytesRead;}if(pos!==stat.size||(await fh.stat()).size!==stat.size)throw new Error('changed');draft=JSON.parse(bytes.toString('utf8'));}finally{await fh.close();}}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;reportStorageIssue(this.root,file,error instanceof SyntaxError?'parse':'read');throw new PromptError('STORAGE_CORRUPT','草稿文件损坏或不可读，原文件已保留；请从备份恢复。',500,{category:'recovery',stage:'read',nextAction:'inspect_or_restore'});}
    if(!validStoredDraft(draft,id)){reportStorageIssue(this.root,file,'shape');throw new PromptError('STORAGE_CORRUPT','草稿结构、版本或完整性校验失败，原文件已保留；请从备份恢复。',500,{category:'recovery',stage:'read',nextAction:'inspect_or_restore'});}clearStorageScanIssue(this.root,file);const secrets=this.provider()?.secrets??[];try{assertNoKnownSecret(draft,secrets);}catch{throw new PromptError('RECOVERY_SECRET_BLOCKED','草稿包含当前已知凭证，已阻止读取、重放或组装。',409,{category:'recovery',stage:'read',nextAction:'inspect_or_restore'});}return draft as Draft;
  }
  private diagnostics=new WeakMap<object,CallDiagnostic>();
  private callByValue(value:unknown){return value&&typeof value==='object'?this.diagnostics.get(value as object):undefined;}
  private validateResponse<T>(raw:unknown,stage:string,validate:()=>T):T {
    try{return validate();}catch(error){if(error instanceof PromptError){const diagnostic=this.callByValue(raw);const details=isObject(error.details)?error.details:{};throw new PromptError(error.code,error.message,error.status,{...details,...diagnostic,status:'failed',stage,category:'response_invalid',retryable:true,preserved:false,nextAction:'retry_stage'});}throw error;}
  }
  private async call(system:string,user:unknown,purpose:'prompt'='prompt',signal?:AbortSignal,stage='provider'):Promise<unknown>{
    const provider=this.provider(),requestId=randomUUID(),startedAt=new Date().toISOString(),started=Date.now();let responseMeta:{finishReason:string|null;bytes:number;usage?:{promptTokens?:number;completionTokens?:number}}={finishReason:null,bytes:0};
    const wrap=(code:string,message:string,status:number,category:string,retryable:boolean,nextAction:string):LlmError=>new LlmError(code,message,status,{requestId,stage,startedAt,finishedAt:new Date().toISOString(),durationMs:Date.now()-started,status:'failed',...responseMeta,category,retryable,preserved:false,nextAction});
    if(!provider)throw wrap('LLM_NOT_CONFIGURED','尚未配置产品 LLM Provider，AI Prompt 功能暂不可用；手动 Library 仍可使用。',503,'configuration',false,'check_configuration');
    let result;try{result=await provider.complete({system,user:JSON.stringify(user),timeoutMs:BUDGETS.timeoutMs,maxOutputBytes:BUDGETS.maxOutputBytes,purpose,signal});}catch(error){const code=sanitizeProviderText((error as {code?:string}).code??'LLM_PROVIDER_ERROR',provider.secrets)||'LLM_PROVIDER_ERROR',details=(error as {details?:unknown}).details;const category=isObject(details)&&details.category==='response_invalid'?'response_invalid':classifyProviderFailure(code);if(isObject(details)){responseMeta={finishReason:['stop','length','content_filter','tool_calls'].includes(String(details.finishReason))?String(details.finishReason):null,bytes:typeof details.bytes==='number'&&Number.isFinite(details.bytes)&&details.bytes>=0?details.bytes:0,...(isObject(details.usage)?{usage:{...(typeof details.usage.promptTokens==='number'?{promptTokens:details.usage.promptTokens}:{}),...(typeof details.usage.completionTokens==='number'?{completionTokens:details.usage.completionTokens}:{})}}:{})};}throw wrap(code,sanitizeProviderText(error instanceof Error?error.message:'Provider 调用失败',provider.secrets),(error as {status?:number}).status??502,category,!['configuration','auth','cancelled'].includes(category),category==='cancelled'?'review_preserved_result':category==='configuration'||category==='auth'?'check_configuration':'retry_stage');}
    responseMeta={finishReason:result.finishReason,bytes:result.bytes,...(result.usage?{usage:{...result.usage}}:{})};const base={requestId,stage,startedAt,finishedAt:new Date().toISOString(),durationMs:Date.now()-started,status:'success' as const,finishReason:result.finishReason,bytes:result.bytes,...(result.usage?{usage:{...result.usage}}:{})};
    if(result.finishReason==='length')throw wrap('LLM_OUTPUT_TRUNCATED','Provider 输出被截断，未生成草稿。',502,'response_invalid',true,'retry_stage');if(!result.text.trim())throw wrap('LLM_EMPTY_RESULT','Provider 返回空结果，未生成草稿。',502,'response_invalid',true,'retry_stage');
    let parsed:unknown;try{parsed=JSON.parse(result.text);}catch{throw wrap('LLM_INVALID_JSON','Provider 返回的内容不是合法 JSON，未生成草稿。',502,'response_invalid',true,'retry_stage');}
    assertNoKnownSecret(parsed,provider.secrets);if(parsed&&typeof parsed==='object')this.diagnostics.set(parsed as object,base);return parsed;
  }  async brief(task: unknown, template: unknown, signal?:AbortSignal) {
    try{assertNoKnownSecret(task,this.provider()?.secrets??[]);}catch{throw new PromptError('KNOWN_SECRET_BLOCKED','输入包含当前已知凭证，已阻止发送。',409,{category:'conflict',stage:'brief',nextAction:'remove_secret'});}
    if (!text(task) || !task.trim() || task.length > BUDGETS.task) fail('INVALID_TASK', `任务描述必须为 1–${BUDGETS.task} 字符。`);
    if (!text(template) || !TEMPLATES.some(item => item.id === template)) fail('INVALID_TEMPLATE', '请选择有效的场景模板。');
    const terms = task.toLocaleLowerCase('zh-CN').split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1);
    const wikiCandidates = (await this.wiki.allRecords()).sort((a, b) => score(`${b.title} ${b.tags.join(' ')} ${b.body}`, terms) - score(`${a.title} ${a.tags.join(' ')} ${a.body}`, terms)).map(page => ({ id: page.id, title: page.title, type: page.type, knowledgeStatus: page.knowledge_status, selected: false }));
    const raw = await this.call(`将用户任务整理为结构化 Prompt Brief。只输出严格 JSON，字段契约与合法示例如下：${JSON.stringify(BRIEF_CONTRACT)}。未知业务信息写“待用户补充”，不得虚构。`, { task, template, templates: TEMPLATES },'prompt',signal,'brief');
    const brief = this.validateResponse(raw,'brief',()=>validateBrief(raw));
    const draft = await this.save({ id: randomUUID(), kind: 'generator', createdAt: new Date().toISOString(), status: 'pending', brief, sourceTask: task, wikiCandidateIds: wikiCandidates.map(item => item.id),calls:this.callByValue(raw)?[this.callByValue(raw)!]:[] });
    return { draftId: draft.id, brief, wikiCandidates, provider: this.providerMeta() };
  }
  private providerMeta() { const p = this.provider(); return p ? { name: p.name, model: p.model } : null; }
  private async context(ids: unknown, brief: Brief) {
    if (!Array.isArray(ids) || ids.length > BUDGETS.selectedWiki || ids.some(id => !text(id)) || new Set(ids).size !== ids.length) fail('INVALID_WIKI_SELECTION', `相关 Wiki 最多选择 ${BUDGETS.selectedWiki} 页。`);
    const pages: WikiRecord[] = [];
    for (const id of ids as string[]) { const page = await this.wiki.get(id); if (!page) fail('WIKI_NOT_FOUND', `选择的 Wiki ${id} 已不存在，请刷新后重选。`, 409); await this.wiki.assertRecordSourcesAllowed(page!); pages.push(page!); }
    const terms = `${brief.taskName} ${brief.goal} ${brief.context} ${brief.tasks}`.toLocaleLowerCase('zh-CN').split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1);
    let total = 0;
    const used = pages.map(page => {
      const parts = page.body.split(/\n{2,}/u).map(p => p.trim()).filter(Boolean);
      parts.sort((a, b) => score(b, terms) - score(a, terms));
      let excerpt = '';
      for (const part of parts) {
        if (excerpt && score(part, terms) <= 0) continue;
        const separator = excerpt ? '\n\n' : '';
        const room = Math.min(BUDGETS.perWikiChars, BUDGETS.totalWikiChars - total) - excerpt.length - separator.length;
        if (room <= 0) break;
        excerpt += `${separator}${part.slice(0, room)}`;
      }
      total += excerpt.length;
      return { id: page.id, title: page.title, type: page.type, knowledgeStatus: page.knowledge_status, excerpt, sourceChars: page.body.length, usedChars: excerpt.length, truncated: excerpt.length < page.body.length };
    });
    return used;
  }
  async generate(rawBrief: unknown, ids: unknown, signal?:AbortSignal) {
    const brief = validateBrief(rawBrief,true); const context = await this.context(ids, brief);try{assertNoKnownSecret({brief,context},this.provider()?.secrets??[]);}catch{throw new PromptError('KNOWN_SECRET_BLOCKED','Brief 或 Wiki 背景包含当前已知凭证，已阻止发送。',409,{category:'conflict',stage:'generate',nextAction:'remove_secret'});}
    const categories = (await this.prompts.schema()).categories.map(item => item.id);
    const response = await this.call(`根据用户确认的 Brief 与已选择 Wiki 背景生成完整 Prompt 内容。只输出严格 JSON，契约：${JSON.stringify(contentContract(categories))}。分类必须从给定类别选。未知业务标记待用户补充，不虚构。不得输出相关Wiki、收藏、ID、版本等受控字段。`, { brief, relatedWiki: context, categories },'prompt',signal,'generate');
    const preview = this.validateResponse(response,'generate',()=>validateContent(response, context.map(item => item.id), categories));
    const draft = await this.save({ id: randomUUID(), kind: 'generator', createdAt: new Date().toISOString(), status: 'pending', brief, sourceTask: brief.goal, wikiCandidateIds: context.map(item => item.id), preview,calls:this.callByValue(response)?[this.callByValue(response)!]:[] });
    return { draftId: draft.id, preview, relatedWiki: context, contextBudget: { maxPerWiki: BUDGETS.perWikiChars, maxTotal: BUDGETS.totalWikiChars, used: context.reduce((n, p) => n + p.usedChars, 0) }, provider: this.providerMeta() };
  }
  private running = new Map<string, Promise<unknown>>();
  private replay = new Map<string, unknown>();
  private async optimizerInput(body: unknown, supplement: unknown, targetPromptId: unknown, baseVersion: unknown) {
    if(!text(body)||!body.trim()||body.length>BUDGETS.body) fail('INVALID_PROMPT_BODY',`原 Prompt 必须为 1–${BUDGETS.body} 字符。`);
    if(supplement!==undefined&&(!text(supplement)||supplement.length>BUDGETS.task)) fail('INVALID_SUPPLEMENT','补充要求必须为不超过 10,000 字符的文本。');
    if((targetPromptId===undefined)!==(baseVersion===undefined)) fail('INVALID_TARGET','目标 Prompt 与 baseVersion 必须同时提供。');
    let target: {id:string;version:number;relatedWikiIds:string[]}|undefined;
    if(targetPromptId!==undefined){if(!text(targetPromptId)||typeof baseVersion!=='number'||!Number.isInteger(baseVersion)||baseVersion<1)fail('INVALID_TARGET','目标 Prompt 信息无效。');const current=await this.prompts.get(targetPromptId);if(!current)fail('NOT_FOUND','没有找到目标 Prompt。',404);if(current.version!==baseVersion)fail('VERSION_CONFLICT','目标 Prompt 已有更新版本，请重新打开。',409);for(const id of current.relatedWikiIds){const page=await this.wiki.get(id);if(!page)fail('INVALID_TARGET','目标 Prompt 的关联 Wiki 不存在。',409);await this.wiki.assertRecordSourcesAllowed(page);}target={id:current.id,version:current.version,relatedWikiIds:current.relatedWikiIds};}
    return {body,supplement:text(supplement)?supplement:'',target};
  }
  async check(body: unknown,supplement: unknown,targetPromptId: unknown,baseVersion: unknown,signal?:AbortSignal){
    const input=await this.optimizerInput(body,supplement,targetPromptId,baseVersion);try{assertNoKnownSecret(input,this.provider()?.secrets??[]);}catch{throw new PromptError('KNOWN_SECRET_BLOCKED','输入包含当前已知凭证，已阻止发送。',409,{category:'conflict',stage:'check',nextAction:'remove_secret'});}
    const raw=await this.call(`只检查原 Prompt 的九个维度，不重写正文、不打分。只输出严格 JSON，契约：${JSON.stringify(OPTIMIZATION_CONTRACT)}。证据须引用输入或明确标记缺失。`,{body:input.body,supplement:input.supplement,target:input.target,dimensions:CHECKS.map(([id,label])=>({id,label}))},'prompt',signal,'check');
    const {checks,improvements}=this.validateResponse(raw,'check',()=>{assertContract(raw,OPTIMIZATION_CONTRACT,'九维检查');if(!isObject(raw))fail('LLM_SCHEMA_MISMATCH','Provider 返回的检查结构无效。',502);const checks=validateChecks(raw.checks);return {checks,improvements:validateImprovements(raw.improvements,checks)};});const provider=this.provider();
    const draft=await this.save({schemaVersion:2,id:randomUUID(),kind:'optimizer',createdAt:new Date().toISOString(),status:'pending',stage:'checked',originalBody:input.body,supplement:input.supplement,checks,improvements,targetPromptId:input.target?.id,baseVersion:input.target?.version,wikiCandidateIds:input.target?.relatedWikiIds,inputSha256:createHash('sha256').update(input.body+'\0'+input.supplement).digest('hex'),rulesVersion:'pa01-1',providerIdentity:provider?(provider.cacheIdentity??provider.name+'|'+provider.model):undefined,calls:this.callByValue(raw)?[this.callByValue(raw)!]:[],targetSnapshotSha256:input.target?createHash('sha256').update(stable(input.target)).digest('hex'):undefined,attempts:0,requestIds:[]});
    return {draftId:draft.id,stage:'checked',originalBody:input.body,checks,improvements,target:input.target??null,provider:this.providerMeta()};
  }
  async rewrite(id:string,requestId:unknown,signal?:AbortSignal){
    if(!text(requestId)||!/^[0-9a-f-]{36}$/i.test(requestId))fail('INVALID_REQUEST_ID','requestId 必须是有效 UUID。');
    const replayKey=id+':'+requestId;if(this.replay.has(replayKey)){const stored=await this.get(id);const cached=this.replay.get(replayKey);try{assertNoKnownSecret(cached,this.provider()?.secrets??[]);}catch{throw new PromptError('RECOVERY_SECRET_BLOCKED','重放结果包含当前已知凭证，已阻止返回。',409,{category:'recovery',stage:'replay',nextAction:'inspect_or_restore'});}if(stored?.stage==='ready')return {draftId:id,stage:'ready',preview:stored.preview};return cached;}if(this.running.has(id))fail('OPTIMIZE_IN_PROGRESS','这份草稿正在重写。',409);
    const work=this.doRewrite(id,requestId,signal).catch(error=>{if(error instanceof PromptError&&error.code==='STORAGE_CORRUPT')throw new PromptError('OPTIMIZER_SNAPSHOT_INVALID','检查草稿的结构或绑定校验失败，未调用 Provider。',409,{category:'conflict',stage:'rewrite',retryable:false,nextAction:'rerun_check'});throw error;}).then(value=>{this.replay.set(replayKey,value);if(this.replay.size>256)this.replay.delete(this.replay.keys().next().value!);return value;}).finally(()=>this.running.delete(id));this.running.set(id,work);return work;
  }
  private async doRewrite(id:string,requestId:unknown,signal?:AbortSignal){
    const draft=await this.get(id);if(!draft||draft.kind!=='optimizer')fail('DRAFT_NOT_FOUND','没有找到可重写的检查草稿。',404);if(draft.stage==='ready'&&draft.preview)return {draftId:id,stage:'ready',preview:draft.preview};if((draft.requestIds??[]).includes(String(requestId)))fail('REWRITE_RETRY_REQUEST_ID','失败后的重试必须使用新的 requestId。',409);if(!['checked','failed'].includes(draft.stage??''))fail('DRAFT_NOT_REWRITABLE','草稿尚未完成检查或正在处理。',409);if((draft.attempts??0)>=3)fail('REWRITE_LIMIT','重写次数已达上限，请重新运行检查。',409);
    const provider=this.provider();if(!provider)throw new LlmError('LLM_NOT_CONFIGURED','尚未配置产品 LLM Provider，AI Prompt 功能暂不可用；手动 Library 仍可使用。',503);const identity=provider.cacheIdentity??provider.name+'|'+provider.model;if(draft.rulesVersion!=='pa01-1')fail('RULES_CHANGED','优化规则已变化，请重新检查。',409);if(identity!==draft.providerIdentity)fail('PROVIDER_CHANGED','Provider 已变化，请重新检查原 Prompt。',409);
    if(createHash('sha256').update((draft.originalBody??'')+'\0'+(draft.supplement??'')).digest('hex')!==draft.inputSha256)fail('INPUT_CHANGED','检查输入已变化，请重新运行检查。',409);
    if(draft.targetPromptId){const current=await this.prompts.get(draft.targetPromptId);if(!current||current.version!==draft.baseVersion)fail('VERSION_CONFLICT','目标 Prompt 已变化，请重新检查。',409);const currentBinding={id:current.id,version:current.version,relatedWikiIds:current.relatedWikiIds};if(createHash('sha256').update(stable(currentBinding)).digest('hex')!==draft.targetSnapshotSha256||stable(current.relatedWikiIds)!==stable(draft.wikiCandidateIds))fail('TARGET_CONTEXT_CHANGED','目标关联上下文已变化，请重新检查。',409);for(const wid of draft.wikiCandidateIds??[]){const page=await this.wiki.get(wid);if(!page)fail('INVALID_TARGET','目标关联 Wiki 已不存在。',409);await this.wiki.assertRecordSourcesAllowed(page);}}
    const categories=(await this.prompts.schema()).categories.map(x=>x.id);draft.stage='rewriting';draft.lastRequestId=String(requestId);draft.requestIds=[...(draft.requestIds??[]),String(requestId)];draft.attempts=(draft.attempts??0)+1;await this.save(draft);
    try{const raw=await this.call(`严格按协议生成完整优化后的 Prompt 内容，不输出检查。只输出 JSON，契约：${JSON.stringify(contentContract(categories))}。分类限给定值；未知内容标待用户补充。`,{body:draft.originalBody,supplement:draft.supplement??'',checks:draft.checks,improvements:draft.improvements,target:{id:draft.targetPromptId,version:draft.baseVersion},categories},'prompt',signal,'rewrite');const preview=this.validateResponse(raw,'rewrite',()=>validateContent(raw,draft.wikiCandidateIds??[],categories));draft.calls=[...(draft.calls??[]),...(this.callByValue(raw)?[this.callByValue(raw)!]:[])];draft.preview=preview;draft.stage='ready';draft.lastError=undefined;await this.save(draft);return {draftId:id,stage:'ready',preview};}
    catch(error){draft.stage='failed';const details=(error as {details?:unknown})?.details;const diagnostic=isCallDiagnostic(details)?{...details,status:'failed' as const}:undefined;if(diagnostic)draft.calls=[...(draft.calls??[]),diagnostic];const code=(error as {code?:string}).code??'LLM_PROVIDER_ERROR';const category=(isObject(details)&&text(details.category)?details.category:classifyProviderFailure(code));const retryable=isObject(details)&&typeof details.retryable==='boolean'?details.retryable:!['configuration','auth','cancelled','storage'].includes(category);draft.lastError={category,retryable};await this.save(draft);const safeDetails={...(diagnostic?{startedAt:diagnostic.startedAt,finishedAt:diagnostic.finishedAt,durationMs:diagnostic.durationMs,finishReason:diagnostic.finishReason,bytes:diagnostic.bytes,usage:diagnostic.usage}:{}),...(isObject(details)&&Array.isArray(details.errors)?{errors:details.errors,totalErrors:details.totalErrors}:{}),requestId:isObject(details)&&text(details.requestId)?details.requestId:randomUUID(),stage:'rewrite',category,retryable,preserved:['originalBody','checks','improvements'],draftId:id,nextAction:retryable?'retry_rewrite':category==='auth'||category==='configuration'?'check_configuration':'inspect_or_restore'};throw new PromptError(code,error instanceof Error?error.message:'重写失败，检查结果已保留。',(error as {status?:number}).status??502,safeDetails);}
  }
  async listDrafts(){const scan=await scanJsonRecords<unknown>(this.dir,(v,file):v is unknown=>isObject(v)&&validStoredDraft(v,path.basename(file,'.json')),this.root);const items=[];let rejected=false;for(const record of scan.records){const d=record.value as Draft;clearStorageScanIssue(this.root,record.file);try{assertNoKnownSecret(d,this.provider()?.secrets??[]);}catch{reportStorageIssue(this.root,record.file,'shape');rejected=true;continue;}items.push({id:d.id,kind:d.kind,status:d.status,stage:d.stage??(d.preview?'ready':'checked'),title:d.preview?.name??d.brief?.taskName??'Prompt 草稿',createdAt:d.createdAt});}return {items,needsRecovery:rejected||scan.issues.length>0||scan.partial};}async optimize(body:unknown,supplement:unknown,targetPromptId:unknown,baseVersion:unknown,signal?:AbortSignal){const checked=await this.check(body,supplement,targetPromptId,baseVersion,signal);try{const result=await this.rewrite(checked.draftId,randomUUID(),signal) as {preview:Preview};return {draftId:checked.draftId,originalBody:checked.originalBody,checks:checked.checks,improvements:checked.improvements,preview:result.preview,target:checked.target,provider:checked.provider};}catch(error){throw error;}}
  async confirm(id: string, requestId: unknown, mode: unknown, input: unknown) {
    if (!text(requestId) || !/^[0-9a-f-]{36}$/i.test(requestId)) fail('INVALID_REQUEST_ID', 'requestId 必须是有效 UUID。');
    if (mode !== 'new' && mode !== 'version') fail('INVALID_CONFIRM_MODE', '保存方式无效。');
    const draft = await this.get(id); if (!draft) fail('DRAFT_NOT_FOUND', '没有找到这份 Prompt 草稿。', 404);
    if (!draft.preview) fail('DRAFT_NOT_CONFIRMABLE', '这份草稿内容不完整。', 409);
    if (mode === 'new' && requestId !== draft.id) fail('INVALID_REQUEST_ID', '新建保存必须使用草稿提供的 requestId。', 400);
    try { assertNoKnownSecret(input,this.provider()?.secrets??[]); } catch { throw new PromptError('KNOWN_SECRET_BLOCKED','确认内容包含当前已知凭证，已阻止正式写入。',409,{category:'conflict',stage:'confirm',nextAction:'remove_secret'}); }
    const serialized=stable(input);const hash=draft.schemaVersion===undefined&&draft.confirmed?serialized:createHash('sha256').update(serialized).digest('hex');
    if (draft.confirmed) {
      if (draft.confirmed.requestId !== requestId || draft.confirmed.mode !== mode || draft.confirmed.payloadHash !== hash) fail('REQUEST_ID_CONFLICT', '这份草稿已用另一组内容保存，不能复用。', 409);
      try { const snapshot=(await this.prompts.getVersion(draft.confirmed.promptId,draft.confirmed.version)).snapshot;assertNoKnownSecret(snapshot,this.provider()?.secrets??[]);return {prompt:snapshot,reused:true}; }
      catch { throw new PromptError('CONFIRMATION_RECOVERY_REQUIRED', 'Prompt 已提交，但无法读取其确认版本；请保留草稿并重试。', 500, { committed: true, promptId: draft.confirmed.promptId, version: draft.confirmed.version }); }
    }
    if (draft.status !== 'pending') fail('DRAFT_NOT_CONFIRMABLE', '这份草稿已保存。', 409);
    if (mode === 'version' && (!draft.targetPromptId || !draft.baseVersion)) fail('INVALID_CONFIRM_MODE', '此草稿未绑定原 Prompt，只能保存为新 Prompt。');
    const source = draft.kind === 'optimizer' ? 'optimized' : 'ai_generated';
    const result = await this.prompts.confirmAi({ requestId, mode, promptInput: input, targetPromptId: mode === 'version' ? draft.targetPromptId : undefined, baseVersion: mode === 'version' ? draft.baseVersion : undefined, source });
    try { assertNoKnownSecret(result.prompt,this.provider()?.secrets??[]); } catch { throw new PromptError('CONFIRMATION_SECRET_BLOCKED','正式版本包含当前已知凭证，已阻止回显；提交状态需对账。',409,{category:'recovery',stage:'confirm',committed:true,promptId:result.prompt.id,version:result.prompt.version,nextAction:'inspect_or_restore'}); }
    // The Prompt record itself carries an atomic idempotency receipt. If this draft write fails,
    // retry replays the same receipt without adding another version.
    draft.status = 'confirmed'; draft.confirmed = { requestId, mode, payloadHash: hash, promptId: result.prompt.id, version: result.prompt.version };
    try { await this.save(draft); }
    catch {
      throw new PromptError('PROMPT_COMMITTED_DRAFT_RECOVERY', 'Prompt 已保存，但草稿确认标记没有落盘；正式记录未丢失。请保留此草稿并用相同请求内容重试以完成对账。', 500, { committed: true, promptId: result.prompt.id, version: result.prompt.version, recoveryHint: 'retry_same_payload' });
    }
    return result;
  }
}
function score(textValue: string, terms: string[]) { const lower = textValue.toLocaleLowerCase('zh-CN'); return terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0); }






