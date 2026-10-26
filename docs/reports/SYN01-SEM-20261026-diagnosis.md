# SYN01-SEM seq243零调用诊断

2026-10-26，Sol High。诊断基线/实际HEAD `9622d9b98172b04eba9b52b2c833b958a4f757ef`，产品仍 `d0553163a09f3ac5f4681430e398e7ef2b2d934a`；knowledge-workflows.ts SHA256 `b3269a215ed042b6822a2b77320d3cd2be60d0c40797b7cce50794e8047efbc9`。**仅完成诊断，未施工，待Astra确认最小方案。** 本轮真实0、实际配置读取0、服务0、磁盘候选写入0；知识243/500、Prompt15/24保持。

本轮仅新增本报告，不修改产品/tests/旧原稿/主状态/Git。AGENTS.md、.agents/、AGENT-ROUTER外部修改保留。中断前没有报告，恢复后沿用已经取得的证据，没有从头重跑工程矩阵。

## 原稿事实及具体位置

唯一脱敏导出 `SYN01-RECHECK-20261026-export-1792985404518.json` SHA256 `2c7bd005e904ac31c23000cb4b609b7642f1584079c42cd328ceecde5bfbe573`；独立质量报告 `SYN01-RECHECK-AUDIT-20261026-quality.md` SHA256 `cdcb320d5dd4143bb4d049332de4792133c93d868e0f4039cf1748fdfcfd1b51`。未读实际私有response或配置。

| 缺陷 | 原稿直接证据 | 对应原文 |
|---|---|---|
| 未来边界缺失 | suggestedAdditions/conflicts/agreement全部text及inferences/openQuestions字符串没有表达AI辅助审批仅未来建议、未上线、收益未知。 | 两份输入原文均完整包含该句；A=[74,99)，B=[79,104)。整篇quote被动包含它，不等于综合正文有意保留。 |
| conflicts[0]单条超出来源 | 附A，写“资料A为20家/20%，资料B为30家/30%”。 | A只明确20家/20%，没有B30家/30%。 |
| conflicts[1]单条超出来源 | 附B，写“资料B记录…30%…与资料A的20家/20%不一致”。 | B只明确30家/30%，没有A20家/20%。 |
| agreement[0]单条超出来源 | 附A，却写“资料B同样记录2026年9月目标门店100家”。 | A可支持自己的目标100，不能独自证明B也如此。别条引用B不自动成为本条引用。 |

未把“遗漏”夸称为模型明确断言AI已上线。冲突双方、共同100、公式、未知负责人/采样日集合中仍保留；这些局部正确不能抵消本次两项质量缺陷。原稿9条来源定位通过保持，不回退前轮F01–05结论。

## 已证实的机制与不能确定项

1. **请求没有截断/丢掉未来句。** knowledge-workflows.ts:164–180读取双Raw、核实际SHA并发送完整body及目录；脱敏请求可见两句均在。不是输入缺失或解析器漏读字段。
2. **单条来源约束已写入提示，模型此次没有遵从。** :180明确“每条只陈述所附来源支持的最小断言”“共同观点…分别列出各来源支持条目”“冲突两方各自列证”。三条原稿仍混写另一Raw。不能把模型原稿错误归成服务端自动拼接。
3. **未来句“必须保留”的可检查契约缺失。** :180要求未知/未来/尚未上线/收益未知“不得写成已证事实”，但没有逐来源内容清单、不得遗漏要求或覆盖回执。“不改成肯定事实”并不机械等价于“必须表达该限制”；本次省略违反固定oracle，但不能仅凭这句话认定省略违反了明确的逐项必填协议。
4. **校验只约束位置，不约束text支持。** :185–196按当前 `(rawId,locatorId)`取目录、派生quote/偏移并做秘密/slice校验；:209–246仅检查结构、字段和长度；:279–287的validateEvidence也未判断text每个断言是否受quote支持。A/B目录各只有一个整篇锚点：[0,99)/[0,104)，只用过两ID不代表原文每个命题已被表达。
5. **服务忠实保存模型文本。** :202把三事实数组的text直接映射到sections，:203保存其对应单Raw证据，没有去掉AI句或补入B断言。workflowReview():55–62只从这些返回sections生成审查单元；漏掉的原文内容不会自动成为独立待审unit。human-review.ts:72–79验证已有单元来源与slice，不枚举原Raw语义覆盖；这是当前设计边界。现有人工审查会阻止未经明确确认的正式写入，但不能因此称模型原稿已完整。

可以证明上面的输入、输出及程序接受机制；**不能**由一次样本证明模型内部注意力、推理方式、token限制、服务商行为或永久遵从率，也不能证明仅加一句提示即可解决。finishReason=stop与语义正确无等价关系。

需求依据：product-spec.md顶部2026-10-23 HUMAN增量保留schema/来源/覆盖机械门禁，取消B1模型语义审核作为候选前置阻断，逐页人工确认仍必需；§九区分来源事实/AI整理/推断/问题，§十七要求多来源一致/冲突/待确认，§二十四要求冲突双方保留。NEXT-PREP-20261024-next-task.md固定oracle另明确共同AI未上线/收益未知必须保全。不能借返修恢复额外LLM语义审核或自动判真机制。

## 本轮最小复现与复用点

实际执行一次PowerShell here-string管道：`@'…'@ | node --import tsx --input-type=module`，Node `v24.20.0`，exit0，工具墙钟1.171秒。脚本使用生产KnowledgeWorkflowStore.createSynthesis/call/证据归一化；Raw get为脱敏导出的内存映射，WikiStore.schema正常只读规则，provider.complete只返回原response，save截获在内存中，未initialize或创建目录。

核心操作可复现为：

```javascript
const e = JSON.parse(await fs.readFile(exportPath, 'utf8'));
const q = e.artifacts['request-243.json'].request;
const input = JSON.parse(q.user);
const raws = { get: async id => e.raws.find(r => r.id === id) };
const wiki = new WikiStore('SYN01-SEM-NOT-CREATED', raws);
const store = new KnowledgeWorkflowStore('SYN01-SEM-NOT-CREATED', wiki, raws);
store.save = async record => record; // 截获，不落盘
const record = await store.createSynthesis({rawIds:input.raws.map(r=>r.id),provider:{
  name:'SYNTHETIC-OFFLINE-ORIGINAL-REPLAY',model:'no-model-call',secrets:[],
  complete:async request=>{assert.deepEqual(request,q);return e.artifacts.response;}
}});
```

实际输出：内存响应回放1、截获save1、磁盘写入0；status=pending_confirmation、9条evidence、12个人审unit、approvals0。逐section断言存入的text/字符串与原response完全相等。五section语义字符串不含AI/未来/未上线/收益；该检索只辅助复核，质量判断仍来自上述逐条全文对照，不把关键词检测当语义证明。导出前后SHA相同。exit0表示机制复现成功，**不是质量通过**。

只读探查现成 `buildKnowledgeAtoms`（services/llm/knowledge-atoms.ts:5–26，SHA256 `59920e86f361bdbd1465f75cdd57619cfd181342b934949ac8b0a2abc70beb9a`）：按内容中性的标点/有界切分保留原文、否定与限定词，现样本每Raw5个片段，未来句分别为各自第5片段，均fragment=false。**它生成的裸ID在两Raw都为raw-a0001…raw-a0005**，若用于综合必须由本次Raw/SHA重新命名，不能直接合并。该辅助函数可只读复用，不需改公共算法或接入完整KB02提取/规划流程。

## 建议Astra裁定的最小修复边界

供Astra裁定的候选A：只为新synthesis收紧“来源陈述”的生成方式，采用**完整来源片段覆盖＋每条来源陈述必须逐字等于其所选片段**。它以机械约束直接封住本次两个可重现缺口，不建设通用语义验证器，不增加模型调用/重试，不针对AI/未来/20%/30%等词编规则；它不是已批准需求或唯一可选实现。

具体建议：

- 在当前Raw/SHA/locator之后，复用buildKnowledgeAtoms生成覆盖正文的来源片段目录；以Raw ID+实际SHA+序号绑定ID，保留start/end/fragment及所覆盖locator。空白如何计入、片段数量/输入预算边界应由Astra在卡中明确；只可有界拒绝，不截断、静默删除或按关键词过滤。长句fragment不是经证明独立的事实，必须保持原文上下文/片段标识，不宣称自动理解。
- 将**新Provider契约明确升为v2**，仍八顶层字段；三来源数组条目采用严格 `{text,rawId,unitId}`。模型只决定来源片段分栏；服务端要求text与该unit.text完全相同，全部输入unit在这三个数组合计恰好引用一次。缺失/重复/错Raw/旧SHA/未知ID/改写或额外字段拒绝，不自动补写/修复。显式要求内容限定与未知状态完整保留；所有片段都需覆盖，不建立“关键字必保”表。
- 事实text使用被严格核对的原文，证据由该unit的精确slice派生，继续秘密检查/原证据校验；API与持久化仍为原sections字符串及单Raw证据结构。题目/分类继续现规则；inferences/openQuestions仍按模型推断/问题字符串独立保存，人审责任保持。原文的“未知/问题”是来源本身的表达，不得生成已确认答案；即使它被原文片段保留，也不能取消相应问题审查。
- 这样未来句缺其ID即拒绝；若单Raw条目夹入另一Raw断言，其text不等于所选原文即拒绝。保持不同来源的重复原文各自完整身份，不用首匹配quote，也不把集合里的另一证据暗挂给本条。共同/冲突**分类是否正确仍须人工审查**；机械全覆盖/逐字相等不证明两来源等价或矛盾。
- 旧已保存Workflow继续原读/审/确认，无迁移或重写；新请求不fallback v1。旧243响应仍原样保留，作为旧真实质量FAIL；在v2入口因旧版本拒绝只证明协议隔离，不能冒称程序已理解并识别它的语义。新正反例必须标合成。

这是对事实分栏自由改写能力的明确收紧，**需Astra先确认才施工**。它牺牲部分来源陈述的概括自由，换取内容与来源支持可机械验证；完整长文综合可能更冗长，不承诺所有输入的主题/分栏质量。

候选B是保留自由综合整理：仍允许模型概括、同义表达与跨来源复合陈述，增加明确的来源片段覆盖要求/回执，以及复合陈述的多证据或拆分断言约定，并由人工逐条确认实际支持。此选项更接近现有自由整理能力，但“声明覆盖全部unit”本身不能证明text表达了每个unit，引用了两Raw也不能证明复合句成立；只凭零调用离线正例不能宣布本次两个语义缺陷得到确定修复。若Astra选择B，需先冻结具体证据/人工责任边界及对应需求，不能把追加提示或更多引用当作语义保证。两选项均不能省略现有人审，均未获本报告授权；本轮不扩展其实施或通用语义框架。

## 建议允许文件与必要离线验收

建议产品仅 `services/wiki/knowledge-workflows.ts` 的synthesis请求、专用v2解析/覆盖/逐字约束及原结构归一化；只读复用knowledge-atoms.ts/locators.ts，不改Provider、规则、UI、存储validators、人审公共机制或KB02链。测试新增本轮SEM前缀及必要fake helper；默认受影响synthesis桩范围仍限前轮四文件（b05、kb02-final-agreement、kb02-human-review、pa01-r01-r02），只做协议迁移，不改旧测试目的或旧acceptance证据。是否批准这些文件由Astra卡冻结，本诊断不授权写入。

| 建议验收ID | 必要证据/停止边界 |
|---|---|
| SM01 原失败保留 | 沿用本次原响应内存接受复现与独立质量FAIL证据；版本变更后原稿原样拒绝、原SHA不变。不要把旧格式拒绝当自动语义识别。 |
| SM02 完整与来源约束 | 合成固定样本10片段完整分栏；未来/否定/未知限定在实际sections文字中，text与单Raw原文完全相同；另外一份更换业务名/数值及限制措辞的样本证明无固定词句依赖。 |
| SM03 定向负例 | 省略任一普通片段与任一限定片段都拒绝；仅列全部ID却改text、三种跨Raw复合改写、重复/未知/旧SHA/跨Raw ID拒绝且无save。重复相同文本跨Raw/跨位置按明确ID派生，无首匹配；片段边界/emoji/fragment保留仅测新目录适配。 |
| SM04 兼容及人审 | 一条新v2实际Store/HTTP→未审阻断→明确人审确认回读，证据形状不变；一条旧保存记录无需模型可读/审/确认；一条update evidence-id对照。复用既有秘密、SHA、受限来源、length/分类门禁，仅对新派生片段补秘密回归，不重做F01–05矩阵。 |
| SM05 工程及结论 | TypeScript变更后tsc及上述受影响定向用例；冻结diff/SHA交Astra独立检查。无真实预算不验证模型新协议遵从率，不做新真实/Chrome、全量或旧smoke。 |

本轮未执行这些未来验收项，未写tests或产品；不声称缺陷修复或批次通过。实际还运行了git rev-parse/status、必要rg/Get-Content、Get-FileHash及上述一次内存回放，无全量、旧矩阵、配置读取、模型外发或Git提交推送。源码证据已足，诊断到此收敛；交接Astra确认方案后停写等待。
