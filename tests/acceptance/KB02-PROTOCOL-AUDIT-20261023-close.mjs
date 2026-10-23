// Offline evidence assembly and known-secret scan; no transport.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadLlmConfig,containsKnownSecret} from '../../services/llm/config.ts';
import {sha,scanSecret,ARTIFACT_SHA} from './KB02-PROTOCOL-20261023-runner.mjs';
const dir='docs/reports/',p='KB02-PROTOCOL-20261023-',audit='KB02-PROTOCOL-AUDIT-20261023-';
const a=JSON.parse(fs.readFileSync(dir+audit+'experiment.json','utf8'));
assert.equal(sha(fs.readFileSync(dir+audit+'experiment.json')),ARTIFACT_SHA);
const ledger=fs.readFileSync(dir+p+'attempts.jsonl','utf8').trim().split('\n').map(JSON.parse);
assert.equal(ledger.length,10);
const reasoning=[
 ['原文100/30/30%与旧20/20%及差异待确认均在同指标页，符合。','回款每周核对与负责人未知留在业务页，符合已有审核范围。','只有AI建议/未上线/无收益状态。A把独立表述当独立主题依据，错误；B同样pass，无理由可额外推断。'],
 ['定义、逾期三天无到账触发、提示/核对/审批流程完整，未上线及未知负责人边界保留，A/B均正确。'],
 ['每天按编号核对库存数量有独立行为支持。','原文只命名隔离建议和状态/负责人未知。A声称拟议流程足以支持独立页，错误；B uncertain不放行但未达到预注册reject，不能算准确分类通过。'],
 ['日常库存数量核对独立成立。','包装破损触发、登记/移入/质检复核及未实施边界明示，A/B允许独立拟议流程合理。'],
 ['同案例1指标，事实冲突边界不变。','预注册允许补充规则段承载AI边界；原文没有明确AI与回款的业务关系。A指出此缺口，B允许该归属。该页oracle存在关系范围歧义，独立结论为未决，不将A机械失配认定确定模型错误，也不把B匹配认定语义真值。']
];
const outcomes=[];
for(let i=0;i<10;i++){
 const r=a.requests[i],c=a.cases.find(c=>c.id===r.sampleId),raw=fs.readFileSync(dir+p+`seq${210+i}-response.bin`),envelope=JSON.parse(raw),content=JSON.parse(envelope.choices[0].message.content),result=JSON.parse(fs.readFileSync(dir+p+`seq${210+i}-result.json`));
 assert.equal(ledger[i].sequence,210+i);assert.equal(ledger[i].requestSha256,r.requestSha256);assert.equal(sha(raw),result.responseSha256);assert.equal(sha(r.request),r.requestSha256);
 const n=Number(c.id.slice(-1))-1;
 outcomes.push({sequence:210+i,sampleId:c.id,condition:r.condition,requestSha256:r.requestSha256,responseSha256:sha(raw),structure:result.outcome.structure,preRegisteredMatch:result.outcome.semantic.matches,pages:c.plan.pages.map((p,j)=>({pageIndex:j,title:p.title,unitIds:[...p.factUnitIds,...p.questionUnitIds],expected:c.oracle[j],actual:r.condition==='A'?content.pages.find(x=>x.pageIndex===j).decision:content.decisions[j],originalReason:r.condition==='A'?content.pages.find(x=>x.pageIndex===j).reason:null,independentAssessment:reasoning[n][j],oracleAmbiguity:n===4&&j===1}))});
}
const authorization=JSON.parse(fs.readFileSync(dir+p+'authorization.json'));
assert.equal(authorization.realCallsApproved,false);assert.equal(authorization.mainAgentExecutionApproved,false);
const config=await loadLlmConfig({filePath:process.env.FMCG_LLM_CONFIG_FILE||'.env.local'});
const secrets=[config.apiKey,...(config.knownSecrets??[])].filter(Boolean);
let scanned=0,baselinePathPatternMatches=0;
for(const name of fs.readdirSync(dir).filter(n=>n.startsWith(p)||n.startsWith(audit))){
 const b=fs.readFileSync(dir+name,'utf8');
 if(name===audit+'protection-baseline.json'){
  const baseline=JSON.parse(b);
  assert(!containsKnownSecret(b,secrets));
  scanSecret(baseline.exclusions,secrets);
  for(const [key,value] of Object.entries(baseline.files)){
   assert(!containsKnownSecret(key,secrets));assert(!containsKnownSecret(value,secrets));
   assert(/^[a-f0-9]{64}$/.test(value));
   assert(fs.existsSync(key));
   if(/(?:sk|rk|pk)[-_][A-Za-z0-9._~-]{8,}/iu.test(key))baselinePathPatternMatches++;
  }
 }else scanSecret(b,secrets);
 scanned++;
}
const output={head:'13e4104e63150c10ec74b2ef2be36ae56c206fb2',product:'bb0f814',realCalls:10,cumulative:219,prompt:'15/24',structurePassed:10,realGateClosed:true,knownSecretScan:{pass:true,files:scanned,baselinePathPatternMatches,initialFailure:'Generic key-like regex matched existing filenames in protection hash map. Strictly checked every map value is SHA256 and each key is an existing path; known-secret checks retained for all keys/values. No raw Provider response exemption.'},outcomes,conclusion:'Protocol simplification does not repair original false pass. Case5 page1 oracle relation is ambiguous; frozen oracle retained. Product defects and KB02 remain FAIL.',command:'node --import tsx tests/acceptance/KB02-PROTOCOL-AUDIT-20261023-close.mjs'};
scanSecret(output,secrets);
fs.writeFileSync(dir+audit+'independent-review.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({pass:true,realCalls:10,cumulative:219,structurePassed:10,secretScanFiles:scanned,gateClosed:true}));
