// Prompt clarity engineering checks only. Authored positives are SYNTHETIC,
// and the original seq243 response remains mechanically accepted, quality FAIL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {KnowledgeWorkflowStore} from '../../services/wiki/knowledge-workflows.ts';
import {WikiStore} from '../../services/wiki/store.ts';

const started=Date.now(),sha=x=>createHash('sha256').update(x).digest('hex');
const file='docs/reports/SYN01-RECHECK-20261026-export-1792985404518.json';
const bytes=await fs.readFile(file),e=JSON.parse(bytes),oldRequest=e.artifacts['request-243.json'].request;
assert.equal(sha(bytes),'2c7bd005e904ac31c23000cb4b609b7642f1584079c42cd328ceecde5bfbe573');
const oldOutput=JSON.parse(e.artifacts.response.text),oldInput=JSON.parse(oldRequest.user),rows=[];
const fields=['suggestedAdditions','conflicts','agreement','inferences','openQuestions'];

async function run(rawEntries,answer){
  const rawStore={get:async id=>rawEntries.find(r=>r.id===id)};
  const wiki=new WikiStore('SYN01-SEM-NOT-CREATED',rawStore),store=new KnowledgeWorkflowStore('SYN01-SEM-NOT-CREATED',wiki,rawStore);
  let captured,calls=0,saves=0,returned;
  store.save=async record=>{saves++;return record;};
  const record=await store.createSynthesis({rawIds:rawEntries.map(r=>r.id),provider:{name:'SYNTHETIC-offline-only',model:'SEM-clarity-check',secrets:[],complete:async request=>{
    calls++;captured=request;returned=typeof answer==='string'?JSON.parse(answer):answer(JSON.parse(request.user));return {text:typeof answer==='string'?answer:JSON.stringify(returned),finishReason:'stop',bytes:1};
  }}});
  assert.equal(calls,1);assert.equal(saves,1);
  for(const f of fields)assert.deepEqual(record.sections[f],['inferences','openQuestions'].includes(f)?returned[f]:returned[f].map(v=>v.text));
  for(const evidence of record.evidence){const raw=rawEntries.find(r=>r.id===evidence.rawId);assert.equal(raw.body.slice(evidence.start,evidence.end),evidence.quote);assert.deepEqual(Object.keys(evidence).sort(),['section','text','rawId','quote','start','end'].sort());}
  assert.equal(record.status,'pending_confirmation');assert.equal(record.humanReview.approvals.length,0);
  return {request:captured,record};
}

const originalRaws=oldInput.raws.map(r=>e.raws.find(raw=>raw.id===r.id));
const original=await run(originalRaws,e.artifacts.response.text);
const {system:oldSystem,...oldRest}=oldRequest,{system,...rest}=original.request;
assert.notEqual(system,oldSystem);assert.deepEqual(rest,oldRest);
assert.deepEqual(JSON.parse(original.request.user),oldInput);
assert.equal(original.record.evidence.length,9);assert.equal(original.record.humanReview.units.length,12);
const semantics=fields.flatMap(f=>original.record.sections[f]).join('\n');
assert(!/AI|未来|未上线|收益/u.test(semantics));
assert(oldOutput.conflicts[0].text.includes('资料B为30家/30%'));
assert(oldOutput.conflicts[1].text.includes('资料A的20家/20%'));
assert(oldOutput.agreement[0].text.includes('资料B同样记录'));
rows.push({id:'SM01',originalMechanicallyAccepted:true,originalQuality:'FAIL_UNCHANGED',sectionsPreserved:true,persistedWrites:0});

for(const required of [
  '所有输入来源的核心事实','否定、条件、适用范围、时间','必须实际写入输出section的text或字符串正文',
  '不能仅因quote包含原文就视为已表达','不要求逐句抄写非实质文本','有跨来源支持时分别写入agreement',
  '对应单源suggestedAdditions','仍待确认的问题单列openQuestions','不把未知变成答案','不把可能原因变成事实',
  '每条有证据text的每个断言','另一条引用不能替本条补支持','通用正例','来源甲记载','来源乙记载',
  '反例：只引甲却写','与乙的月口径不同','输出前自检','冲突双方是否分别保留','未知、待确认与推断是否分开',
])assert(system.includes(required),required);
for(const specific of ['清禾','AI辅助审批','100','20%','30%',...originalRaws.map(r=>r.title)])assert(!system.includes(specific),specific);
assert.equal(oldInput.synthesis_format_version,1);assert.equal(oldInput.categories.length,13);
rows.push({id:'SM02',systemChangedOnly:true,version:1,bodyAndLocatorsUnchanged:true,parametersUnchanged:true,promptPresenceDoesNotProveCompliance:true});

const item=(raw,text)=>({text,rawId:raw.id,locatorId:raw.locators[0].id});
const first=await run(originalRaws,input=>{
  const [a,b]=input.raws;
  return {synthesis_format_version:1,title:'SYNTHETIC 忠实概括双源对比',category:'metric',suggestedAdditions:[],
    agreement:[item(a,'资料A记载二〇二六年九月虚构清禾区域的目标是一百家门店，铺货比例按在售门店与目标门店之比计算。'),item(b,'资料B记载二〇二六年九月虚构清禾区域的门店目标为一百家，铺货比例使用在售数除以目标数。'),item(a,'资料A把审批辅助技术列为后续分析设想，目前没有投用，成效还无法确定。'),item(b,'资料B将审批辅助技术作为将来的分析建议，尚未投用，回报仍不清楚。')],
    conflicts:[item(a,'资料A记载在售门店二十家，铺货比例为百分之二十。'),item(b,'资料B记载在售门店三十家，铺货比例为百分之三十。')],
    inferences:['两组数值差异的原因仍需调查，现有材料不能确定。'],openQuestions:['两份资料的采样日期是否相同？','异常审批由谁负责仍需确认。']};
});
assert(first.record.sections.agreement.some(t=>t.includes('没有投用')&&t.includes('无法确定')));
assert(first.record.sections.conflicts.every((t,i)=>!t.includes(i===0?'资料B':'资料A')));
assert(first.record.evidence.some(p=>!p.quote.includes(p.text))); // Faithful paraphrase remains allowed.
rows.push({id:'SM03-fixed',synthetic:true,authoredResponse:true,freeParaphraseAccepted:true,reviewApprovals:0,qualityClaim:'NOT_A_REAL_MODEL_RESULT'});

const make=(title,body)=>({id:randomUUID(),title,body,bodySha256:sha(body)});
const otherRaws=[make('SYNTHETIC 森岚检修记录甲','森岚装置检修方案仅在白班小范围试用，夜班适用性未经验证。统计按自然周归集。自动排程仍是拟议方案，尚未启用，节省工时尚无测量结论。'),make('SYNTHETIC 森岚检修记录乙','森岚装置检修方案限定白班试用，不能据此确认夜班可用。统计按自然月汇总。自动排程只是准备建议，当前未投入使用，工时影响缺少测量。')];
const other=await run(otherRaws,input=>{
  const [a,b]=input.raws;
  return {synthesis_format_version:1,title:'SYNTHETIC 森岚试用条件整理',category:'other',suggestedAdditions:[],
    agreement:[item(a,'甲记录把试用范围限定于白班，夜班效果尚缺验证；排程自动化只是提案，未启动且没有工时收益测量。'),item(b,'乙记录说明试用仅面向白班，夜班是否适用未有结论；自动排程还在建议阶段，没有运行，也没有工时影响数据。')],
    conflicts:[item(a,'甲记录的统计窗口是自然周。'),item(b,'乙记录采用自然月汇总。')],inferences:[],openQuestions:['夜班适用性及自动排程工时影响何时能完成测量？']};
});
assert(other.record.sections.agreement.every(t=>t.includes('夜班')&&t.includes('白班')));
assert(other.record.evidence.some(p=>!p.quote.includes(p.text)));
rows.push({id:'SM03-other',synthetic:true,authoredResponse:true,differentDomainAndQualifiers:true,freeParaphraseAccepted:true,qualityClaim:'NOT_A_GENERALIZATION_TEST'});
assert.equal(sha(await fs.readFile(file)),sha(bytes));
console.log(JSON.stringify({kind:'PROMPT_CLARITY_ENGINEERING_ONLY',node:process.version,elapsedMs:Date.now()-started,rows,originalExportSha256:sha(bytes),inMemoryProviderReplays:3,persistedWrites:0,realCalls:0,actualConfigReads:0,servicesStarted:0,realSemanticDefects:'NOT_PROVEN_FIXED'},null,2));
