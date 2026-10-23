import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const prefix='docs/reports/KB02-SEMANTIC-AUDIT-20261023-';
const tracePath='docs/reports/KB02-REGION-AUDIT-20261023-provider-trace.jsonl';
const traceBytes=await fs.readFile(tracePath);
const traces=traceBytes.toString('utf8').trim().split('\n').map(JSON.parse);
const input=n=>JSON.parse(traces.find(t=>t.sequence===n).request.messages.find(m=>m.role==='user').content.split('\n').at(-1));
const supplement=input(202).sourceContexts[0].text;
const short=input(185).sourceContexts[0].text;
let long='';
for(let n=1;n<=14;n++){
 let block=`【长文验收附录${n}，虚构】\n虚构区域${String(n).padStart(2,'0')}2026年9月有100家目标门店，${n+10}家在售，门店数铺货率${n+10}%。此区域与其它附录区域独立，不能混用。异常审批负责人未知，AI仅未来分析建议。\n`,line=0;
 while(block.length<7600)block+=`附录${n}排版说明${++line}：这里用于验证中文长文保存和完整处理，不补充任何新经营指标、客户身份、AI上线事实或收益。\n`;
 long+=block.slice(0,7600);
}
assert.equal(hash(supplement),'c95c8135f8904824fba6fb4a864932de36561f80d621b530e2543786564e3197');
assert.equal(hash(short),'d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515');
assert.equal(hash(long),'a60cad47549b175a9eedcde1cb1246ddbaba2891abdb492f00212a26aac513c7');
assert.equal(long.length,106400);
const ai='【虚构业务设计记录，非真实客户资料】\n甲桥财务团队的AI回款异常提示是一项拟议的辅助复核机制，定义为依据应收账款到期日和到账记录，向财务人员提示可能逾期的款项。\n拟议触发条件是款项已超过应收账款到期日三天且仍无到账记录。触发后，系统拟生成包含单据编号、到期日和未到账金额的提示，由财务人员逐笔核对，再将核对结果交给审批人员。\n该机制尚未上线，未发生实际提示，也没有收益或准确率实测。异常审批负责人尚未确定。';
const metric='【虚构指标定义与基期记录，非真实客户资料】\n指标名称：门店数铺货率。指标定义：同一产品、区域和统计月份内，在售门店数占目标门店数的比例。计算公式：门店数铺货率＝在售门店数÷目标门店数×100%。目标门店数为零时该比率不计算。\n虚构饮料甲2026年9月甲桥区域的基期记录为目标门店100家、在售门店20家，按上述公式计算门店数铺货率为20%。统计单位为门店数，该指标不表示销量或销售额。\n本记录的具体采样日期尚未注明。';
const historical=(sequence,sha256)=>({path:tracePath,sha256:hash(traceBytes),sequence,bodySha256:sha256});
const mk=(id,body,source,oracle)=>({id,body,chars:body.length,utf8Bytes:Buffer.byteLength(body),sha256:hash(body),source,oracle});
const fixtures=[
 mk('supplement-original',supplement,historical(202,hash(supplement)),{
 required:['甲桥/虚构饮料甲/2026年9月/100目标/30在售/30%完整保留','旧20家及20%与新30家及30%并列，口径或采样时间差异待确认，不能静默替代','财务每周核对回款一次','异常审批负责人需访谈确认','AI未来建议、无上线或收益事实作为相关业务主题边界保留'],
 forbidden:['仅凭AI未来/未上线边界独立生成机制或边界空主题','编造上线、收益、触发条件或流程','删边界以使页面通过'],
 pageCount:'不固定；按实际独立主题支持判断',purpose:'原P1反例；必须生成完整合规草稿，只有拒绝不算修复成功'}),
 mk('mixed-short-original',short,historical(185,hash(short)),{
 required:['全部原经营事实、计算方式和业务边界/未知保留并有依据归属'],
 type:'沿现有分类规范按实际内容判断；concept并非强制分类错误，不要求本混合样本必须metric',
 historical:'seq185未产生旧任务卡所需metric目标的事实保留；本轮不追改历史',purpose:'短文真实质量及通用候选更新回归'}),
 mk('long-original',long,{...historical(200,hash(long)),checkpointPath:'docs/reports/KB02-REGION-AUDIT-20261023-long-checkpoint.json',reconstruction:'本脚本14段各7600字符，结果SHA必须等于历史不可变Raw'}, {
 regions:Array.from({length:14},(_,i)=>({subject:'虚构区域'+String(i+1).padStart(2,'0'),month:'2026年9月',targetStores:100,sellingStores:i+11,distributionPercent:i+11,independence:'此区域与其它附录区域独立，不能混用。',boundary:'异常审批负责人未知，AI仅未来分析建议。'})),
 required:['逐区域原文事实/日期/数值及独立性保留，不跨主体混用','每个已提取unit和原ID恰好一次，且另查原文业务事实没有漏提','未知/未来边界归相关主体，非业务排版不转经营事实'],
 pageCount:'不固定14页；历史55unit/101ID仅作为旧结果参考，不固定本轮提取数量'}),
 mk('independent-ai-positive',ai,{kind:'new-fictional-preconstruction-fixed'}, {
 required:['保留独立机制定义：到期日和到账记录驱动辅助复核','保留超过到期日三天且仍无到账的拟议触发条件','保留提示字段、财务逐笔核对、交审批的拟议流程','尚未上线、未实际提示、无收益/准确率实测、负责人未知均保留'],
 positiveGate:'有上述原文依据的独立AI机制页应能通过审核并形成草稿；全拒绝或将整个机制当非业务不通过',
 forbidden:['将拟议流程写为已上线事实','仅因未来/未上线/单unit拒绝独立主题','把未知负责人独立灌水建页'],
 fields:'合法type/category且与实际机制内容相符，不固定唯一枚举或页数'}),
 mk('explicit-metric-target',metric,{kind:'new-fictional-preconstruction-fixed-user-approved-metric-capability'}, {
 required:['形成真实metric类型页面，包含定义、公式、适用维度、目标为零不计算边界','虚构饮料甲/甲桥/2026年9月/100目标/20在售/20%不变','门店数不表示销量/销售额，具体采样日期未注明保留'],
 targetGate:'先从实际metric草稿明确创建旧目标，写入人工备注；未生成metric则特定能力前置未达，不改type/不重抽',
 updateSource:'复用同施工冻结下supplement-original的合规草稿，与旧metric同一目标做预览',
 updateOracle:['100目标及主体月份双侧支持','20/20%与30/30%分别保留来源，口径或采样时间差异待确认','保留旧定义/公式/零分母边界/单位限制及人工备注','补充独有财务规则/AI未来限制不可称双侧共识','新增/冲突/推断/待确认分开；不编造精确采样日期或真实时间增长结论','实际Chrome确认前独立审核预览，再确认/刷新/持久回读/幂等'],
 historical:'新增前瞻metric能力证明，不回填原混合短文历史门槛'}),
];
const result={version:1,frozenAt:new Date().toISOString(),reviewer:'Astra',head:'0e44ab5563e5de3f4cdd8ed663a51393fde53422',productCommit:'17121be7ec20f73b367750d281a4e1dd2c742a76',scope:'施工前样本冻结；不调用产品或Provider，不运行新版实现',fixtures,
 dynamicUnitMapping:['不预造或约束模型ID；实际运行后以sourceId与原文start/end绑定，再核unit.kind/memberIds与草稿归属','同位置/同kind/同分栏的固定unit按产品契约验证；同位置fact与question不混合，不拆unit修结果','逐项原文语义oracle→实际提取记录→固定unit→所属页面→证据引用，检查漏提、重复、跨主体及新增断言','每个实际unit与原ID恰一次不是充分语义证明；标题与one_line_definition同样核原文支持','审核pass只证明门禁结果，独立人工语义判定及真实成功输出仍必需；所有自动issues保留逐条裁定'],
 stageBudgets:[{stage:1,maxCalls:6,fixtures:['supplement-original:3','independent-ai-positive:3']},{stage:2,maxCalls:20,fixtures:['mixed-short-original:3','long-original:16','generic-update-preview:1'],reuse:'同冻结阶段一supplement草稿，不能为了预算降低语义/Chrome门槛'},{stage:3,maxCalls:4,fixtures:['explicit-metric-target:3','metric-update-preview:1'],reuse:'同冻结且已合格的阶段一supplement草稿'}],budget:{kb02Before:203,kb02Cap:500,plannedMax:30,plannedAfter:233,promptUsed:15,promptCap:24,realApproved:false,noAutomaticRetry:true},
 immutability:'真实运行前冻结；不得根据输出修改样本或oracle、挑选结果重抽。若源证据/fixture哈希变化，停止并单独审查。阶段分别放行，异常调用仍入账。'};
const destination=prefix+'fixtures.json';
await fs.writeFile(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({destination,sha256:hash(await fs.readFile(destination)),fixtures:fixtures.map(({id,chars,sha256})=>({id,chars,sha256})),realCalls:0}));
