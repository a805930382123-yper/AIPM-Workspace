// Offline proposal materialization only. No Provider, server or product mutation.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/reports/KB02-REPLAN-20261023-';
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const rows=fs.readFileSync('docs/reports/KB02-SEMANTIC-AUDIT-20261023-provider-trace.jsonl','utf8').trim().split(/\r?\n/).map(JSON.parse);
const original=n=>rows.find(r=>r.sequence===n).request;
const aSystem=original(206).messages[0].content;
assert.equal(aSystem,original(209).messages[0].content);
const protocolStart=aSystem.indexOf('按候选0起pageIndex');
const common=aSystem.slice(0,protocolStart);
const bProtocol='按候选pages原顺序逐页返回decisions数组，项数必须与候选页数完全相等，每项仅pass/reject/uncertain。pass须有本页原文事实支持独立主题；证据不足用uncertain，不能假定通过。全部页面都须审核，不输出理由、引用、代码、页索引或其它字段。审核通过仅代表本次模型判断，不保证语义真值。';
const bSchema={type:'object',additionalProperties:false,required:['decisions'],properties:{decisions:{type:'array',minItems:1,maxItems:50,items:{type:'string',enum:['pass','reject','uncertain']}}}};
const bSystem=common+bProtocol+'\n严格遵守schema：'+JSON.stringify(bSchema);
const extract=req=>JSON.parse(req.messages[1].content.slice(req.messages[1].content.indexOf('{')));
const cases=[206,209].map((n,i)=>({id:'sample-'+(i+1),originSequence:n,...extract(original(n)),oracle:i===0?['pass','pass','reject']:['pass'],oracleBasis:i===0?'第0页数值冲突保留；第1页财务规则及负责人边界；第2页只有未来/未上线状态，没有独立定义、触发或流程。':'唯一页有定义、逾期三天且无到账触发、提示核对审批流程；未来/未上线边界不取消独立主题。'}));
function controlled(positive){
 const lead='【虚构仓库业务记录，非真实客户资料】\n';
 const daily='甲桥仓库每天按商品编号核对库存数量。';
 const detail='破损商品隔离是一项拟议的仓储处置流程，用于将包装破损商品移出可售库存。发现商品包装破损时，仓管员拟先登记商品编号与破损数量，再移入隔离区，最后由质检人员复核处置。';
 const boundary='破损商品隔离为未来建议，尚未实施，也没有效果事实。';
 const question='该隔离流程的负责人尚未确定。';
 const texts=[daily,...(positive?[detail]:[]),boundary,question];
 const raw=lead+texts.join('\n');
 const input={facts:[],questions:[],factUnits:[],questionUnits:[],sourceContexts:[]};
 let at=lead.length;
 for(let i=0;i<texts.length;i++){
  const text=texts[i],start=at,end=start+text.length,q=i===texts.length-1;
  const sourceId=`s-${start}-${end}`,id=q?'q-c1-1':`f-c1-${i+1}`,unitId=q?`qu-${start}-${end}`:`fu-${start}-${end}-fact`;
  input[q?'questions':'facts'].push({id,text,...(q?{}:{kind:'fact'}),sourceId});
  input[q?'questionUnits':'factUnits'].push({id:unitId,sourceId,text,...(q?{}:{kind:'fact'}),memberIds:[id]});
  input.sourceContexts.push({id:sourceId,start,end,contextStart:0,contextEnd:raw.length,text:raw,factIds:q?[]:[id],questionIds:q?[id]:[]});
  at=end+1;
 }
 const plan={version:3,document:{title:'甲桥仓库库存核对与隔离安排',main_topic:'库存数量核对及拟议隔离流程'},pages:[{title:'甲桥仓库库存数量核对',type:'business_process',category:'supply_chain',factUnitIds:[input.factUnits[0].id],questionUnitIds:[]},{title:'甲桥仓库破损商品隔离（拟议）',type:'business_process',category:'supply_chain',factUnitIds:input.factUnits.slice(1).map(x=>x.id),questionUnitIds:input.questionUnits.map(x=>x.id)}]};
 return {id:positive?'sample-4':'sample-3',originSequence:null,raw,rawSha256:hash(raw),input,plan,oracle:['pass',positive?'pass':'reject'],oracleBasis:positive?'第0页独立日常库存核对；第1页有隔离定义、包装破损触发、登记移入复核流程，未实施与负责人未知保留。':'第0页有日常核对流程；第1页只有隔离建议/未实施/无效果及负责人未知，命名本身没有独立流程依据。'};
}
cases.push(controlled(false),controlled(true));
const schema=JSON.parse(fs.readFileSync('rules/kb02-planning.schema.json','utf8'));
const {validateSchema}=await import('../../services/llm/schema-validator.ts');
for(const c of cases){
 assert.deepEqual(validateSchema(c.plan,schema),[],c.id+' plan schema');
 const units=[...c.input.factUnits,...c.input.questionUnits];
 const known=new Map(units.map(u=>[u.id,u]));
 const used=c.plan.pages.flatMap(p=>[...p.factUnitIds,...p.questionUnitIds]);
 assert.equal(new Set(used).size,units.length);assert.equal(used.length,units.length);
 for(const id of used)assert.ok(known.has(id));
 for(const u of units){const s=c.input.sourceContexts.find(s=>s.id===u.sourceId);assert.ok(s);assert.equal(s.text.slice(s.start-s.contextStart,s.end-s.contextStart),u.text);assert.ok(u.memberIds.every(id=>[...s.factIds,...s.questionIds].includes(id)));}
 assert.equal(c.oracle.length,c.plan.pages.length);
 c.inputPlanSha256=hash({input:c.input,plan:c.plan});
}
const order=[[0,'A'],[0,'B'],[1,'B'],[1,'A'],[2,'A'],[2,'B'],[3,'B'],[3,'A']];
const requests=order.map(([i,condition],index)=>{
 const c=cases[i];const request=structuredClone(original(206));
 request.messages=[{role:'system',content:condition==='A'?aSystem:bSystem},{role:'user',content:i<2?original(c.originSequence).messages[1].content:'请审核下列完整候选知识规划，只输出审核JSON。\n'+JSON.stringify({input:c.input,plan:c.plan})}];
 if(i<2&&condition==='A')assert.deepEqual(request,original(c.originSequence));
 assert.equal(extract(request).plan.pages.length,c.oracle.length);
 return {ordinal:index+1,sampleId:c.id,condition,request,requestSha256:hash(request)};
});
const artifact={status:'PROPOSED_NOT_AUTHORIZED_NOT_EXECUTED',head:'63bd02f62897ca2a135fc9cdcf1a51951ebe40df',realCalls:0,hashEncoding:'SHA256 UTF8 JSON.stringify(request); exact key order as stored',protocol:{commonContentInstruction:common,aSystem,bSystem,aSchema:JSON.parse(aSystem.split('\n严格遵守schema：')[1]),bSchema,bAdditionalValidation:'decisions.length === candidate.pages.length; positional binding to immutable request; no repair',difference:'Only output protocol suffix and schema replaced; complete source/candidate/user and model parameters identical within each pair'},cases,requests};
fs.writeFileSync(prefix+'experiment.json',JSON.stringify(artifact,null,2)+'\n');
fs.writeFileSync(prefix+'freeze-check.json',JSON.stringify({pass:true,realCalls:0,requests:8,cases:4,checks:['historical A requests deep equal originals','plan schema','unit exact once coverage','source offsets/member bindings','oracle page count','same user/body within each A/B pair'],artifactSha256:hash(fs.readFileSync(prefix+'experiment.json','utf8')),command:'node --import tsx tests/acceptance/KB02-REPLAN-20261023-freeze.mjs'},null,2)+'\n');
console.log('Frozen 4 cases / 8 proposed requests; offline checks passed; real calls 0.');
