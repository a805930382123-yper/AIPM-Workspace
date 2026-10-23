// Offline fixture extension only; no provider or product writes.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { validateSchema } from '../../services/llm/schema-validator.ts';
const stem='docs/reports/KB02-PROTOCOL-AUDIT-20261023-';
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const oldBytes=fs.readFileSync('docs/reports/KB02-REPLAN-20261023-experiment.json','utf8');
assert.equal(hash(oldBytes),'1d11e66fd8ba5e37dab18a1fc4722044d753d0907efa0ccded96f9332498f114');
const old=JSON.parse(oldBytes),out=structuredClone(old);
out.status='USER_AUTHORIZED_PENDING_MAIN_AGENT_EXECUTION_GATE';
out.head='13e4104e63150c10ec74b2ef2be36ae56c206fb2';
out.realCalls=0;
out.budget={start:209,maximumNew:10,maximumCumulative:219,totalLimit:500,promptUnchanged:'15/24'};
out.authorization={userApproved:true,executionApproved:false};
out.extendsArtifactSha256=hash(oldBytes);
const fifth=structuredClone(old.cases[0]);
fifth.id='sample-5';
fifth.originSequence=206;
fifth.provenance='Human-controlled candidate variation of sample-1; original input and all original units unchanged; not a new model extraction or generated plan.';
const boundary=fifth.plan.pages.pop();
fifth.plan.pages[1].factUnitIds.push(...boundary.factUnitIds);
fifth.plan.pages[1].questionUnitIds.push(...boundary.questionUnitIds);
fifth.oracle=['pass','pass'];
fifth.oracleBasis='第0页保持铺货率事实及20/30冲突；第1页以已有财务回款核对规则为承载主题，保留负责人未知及AI建议未上线/无收益边界。AI句不再自立主题，不增加触发/流程/上线事实，也不把建议变成现行业务规则。原文补充规则段提供共同业务上下文；仅归属变化，不推断已定义AI机制。';
fifth.inputPlanSha256=hash({input:fifth.input,plan:fifth.plan});
out.cases.push(fifth);
for(const [offset,condition] of ['A','B'].entries()){
 const request=structuredClone(old.requests.find(r=>r.sampleId==='sample-1'&&r.condition===condition).request);
 request.messages[1].content='请审核下列完整候选知识规划，只输出审核JSON。\n'+JSON.stringify({input:fifth.input,plan:fifth.plan});
 out.requests.push({ordinal:9+offset,sampleId:'sample-5',condition,request,requestSha256:hash(request)});
}
assert.deepEqual(out.requests.slice(0,8),old.requests);
assert.deepEqual(out.cases.slice(0,4),old.cases);
assert.deepEqual(fifth.input,old.cases[0].input);
const schema=JSON.parse(fs.readFileSync('rules/kb02-planning.schema.json','utf8'));
for(const c of out.cases){
 assert.deepEqual(validateSchema(c.plan,schema),[]);
 const units=[...c.input.factUnits,...c.input.questionUnits];
 const used=c.plan.pages.flatMap(p=>[...p.factUnitIds,...p.questionUnitIds]);
 assert.deepEqual([...used].sort(),units.map(u=>u.id).sort());
 assert.equal(new Set(used).size,used.length);
 assert.equal(c.oracle.length,c.plan.pages.length);
 for(const u of units){const s=c.input.sourceContexts.find(s=>s.id===u.sourceId);assert.ok(s);assert.equal(s.text.slice(s.start-s.contextStart,s.end-s.contextStart),u.text);}
}
for(const r of out.requests){assert.equal(hash(r.request),r.requestSha256);assert.equal(r.request.messages[0].content,r.condition==='A'?out.protocol.aSystem:out.protocol.bSystem);}
for(const c of out.cases){const reqs=out.requests.filter(r=>r.sampleId===c.id);assert.equal(reqs.length,2);assert.equal(reqs[0].request.messages[1].content,reqs[1].request.messages[1].content);}
const bytes=JSON.stringify(out,null,2)+'\n';
fs.writeFileSync(stem+'experiment.json',bytes);
fs.writeFileSync(stem+'freeze-check.json',JSON.stringify({pass:true,realCalls:0,artifactSha256:hash(bytes),originalArtifactSha256:hash(oldBytes),caseCount:5,requestCount:10,firstEightExact:true,originalFourCasesExact:true,caseFiveOriginalInputExact:true,checks:['planning schema','all units exactly once','source offsets','oracle lengths','request hashes','unchanged A/B system','same user content within each pair'],command:'node --import tsx tests/acceptance/KB02-PROTOCOL-AUDIT-20261023-freeze.mjs'},null,2)+'\n');
console.log(JSON.stringify({pass:true,realCalls:0,artifactSha256:hash(bytes),lastRequests:out.requests.slice(8).map(({ordinal,requestSha256})=>({ordinal,requestSha256}))}));
