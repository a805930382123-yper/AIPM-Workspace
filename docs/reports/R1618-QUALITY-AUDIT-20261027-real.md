# R16/R18 真实自动字段质量：独立验收

2026-10-27，Astra medium。用户新增授权最多3次真实请求、使用现有模型配置、失败计入且立即停止。本轮仍只安排245抽取与246规划两次，247未安排、未使用。独立验收不调用Provider、不改产品或原稿、不重跑已通过smoke。

受测准备提交 `86c9c58f6838a393cdbdb10d767a76392861b279`；产品延续原基线 `130e440c3669b839ce433ddbd31d6f886a8637d9`，入口SHA `4b97dbf3e51c4b220a6d885e8c1f3aaab13f71190969c9895b71ba3cea0ed3da`，fixture SHA `9d9cfeae854951628399ed102ad0582dd05e945482663bd2fde9b1949cc3c8c7`，64项冻结聚合 `e46227d640f31cf3b78d25a7e331ace7da67008e298f292f4bfb8b3fdd7745e2`。原独立oracle保持，见[计划审查](R1618-QUALITY-AUDIT-20261027-plan.md)。

## 分层结论

**Q01准备入口通过保持；Q02真实原稿质量未通过（FAIL）；Q03真实outcome→Draft/渲染未执行（NOT_RUN）。** 实际规划返回违反严格schema，执行以 `LLM_SCHEMA_INVALID` 终止，未产生有效outcome或Draft。原始响应还存在跨类型字段和错误引用，不能以若干字段正确代替整体通过。

**R16/R18整项、B09及全产品仍未通过。** 本轮没有新增产品修复，故不声明修复成功；上一轮工程连接通过仍成立。R18历史失败保留。本轮不重试、不人工补稿、不追加抽样，247余量不自动使用。

## 已确认的机械失败

[246公开原响应](R1618-QUALITY-20261027-real-evidence/response-246.json)只有一页business_process，`metrics`和`related_knowledge`放在page顶层，违反页面的additionalProperties限制。独立将**未修改**原响应交当前 `validateSchema`，精确返回：

```text
$.pages[0]: 存在未允许的字段 metrics
$.pages[0]: 存在未允许的字段 related_knowledge
```

实际pipeline在 `knowledge-extraction.ts` 的 `exact(parsed, plannerSchema, ...)` 先失败，未进入expand/组装。独立直接把同一未改原plan交 `expandKnowledgePlan`，另返回 `LLM_PLAN_FIELD_INVALID`：business_process的templateFields里包含只属于concept的`definition`。这是后续约束的离线观察，不能表述为真实运行已走到该阶段。

[246实际请求](R1618-QUALITY-20261027-real-evidence/request-246.json)含完整当前schema、分类型字段目录、字段只能引用本页支持事实、未知归questionUnitIds等要求。因此已确认的是模型原响应不符合已发送契约；没有证据证明执行器漏传这些规则。模型为何违背指令的内部原因未知，不推断为已确认提示长度或模型能力问题。

## 原稿语义核对

| 观察 | 判定及证据 |
| --- | --- |
| 245抽取五条fact及一条question | 原六句分类保留：AI未来/未上线/收益未知为事实限定；异常审批负责人未知为question。规划输入逐条保持原文及原ID |
| 流程目标、角色、触发、步骤 | 本原响应中与资料相符，店长发起/提交、库管核库存/安排发货，顺序无改动；这是字段级观察，不是可用Draft通过 |
| 概念及流程两型覆盖 | 只生成business_process，无Concept，一句话解释/概念栏质量未覆盖；不能人工拆页后签自动通过。单页本身不直接证明违反一般主题拆分规则，但没有达到本轮预先要求的两型覆盖 |
| exceptions字段引用 | 文本为“异常审批负责人未知…”，却引用 `fu-100-123-fact`，对应的是AI未来/未上线/收益未知。实际负责人未知为 `qu-123-137`。文本虽见于Raw，所引事实不支持该字段，引用质量失败 |
| AI机会 | 保留未来、未上线、收益未知，并说明不能视为已实施或有效；没有将建议冒称既成事实。但渲染没有执行，不能签最终“分析建议”标签实测通过 |
| 未提供指标 | 原响应额外建议“可关注缺货相关指标”，没有来源给出具体指标。它是建议性表达而非量化成效事实，但仍未按本轮oracle保持未提供指标栏空/待确认，不能当作来源支持的已完成指标字段 |

异常问题已经在page.questionUnitIds正确分配；错误发生在额外exceptions字段为填栏引用不相干fact。只修JSON嵌套仍不能关闭字段支持问题。

## 实际证据、命令与预算

公开白名单证据位于 [real-evidence](R1618-QUALITY-20261027-real-evidence/result.json)，包含request、公开response、session/release、attempt、result、freeze和checkpoint；独立未读取private响应或模型配置。主Agent实际入口run已失败并停止，result显示reserved2、sent2、configReads1、realCalls2、知识246/500、Prompt15/24。此次真实执行读取现有配置1次是已获授权操作；准备阶段config0结论不等于整轮真实阶段config0。

245预占UTC 11:54:22.531、246预占11:54:27.459；两份attempt均绑定同一会话及release，失败计入。未用247；不得将最多3次理解为失败后继续的许可。主Agent核Raw SHA未变、drafts无文件、candidate-original不存在，独立读取目录也未见candidate-original。

独立实际命令与结果：

- `Get-Content`公开245/246响应、result；读取实际pipeline/schema/planning源码及归档attempt。首次定位`rg`使用Windows不存在的通配路径返回exit1，随后直接读取实际源码完成定位；它不是产品失败。
- PowerShell here-string经 `node --import tsx --input-type=module`：从公开246响应取原plan，`loadExtractionRules('rules')`加载规则，`validateSchema(plan, rules.kb02PlanningSchema)`返回上述2项；检查请求含实际schema及类型/未知规则均true；直接 `expandKnowledgePlan(plan,input)`捕获 `LLM_PLAN_FIELD_INVALID`。exit0，0.451秒。只离线分析，无Provider调用、无响应修补、无新增测试文件。
- `Get-ChildItem`核证据目录，`git rev-parse HEAD`返回上述准备提交。未执行入口run、历史矩阵、浏览器或正式保存。

## 下一步建议

建议下一小批继续B模式，先用本次原始请求/响应做零调用契约诊断：字段必须在templateFields内且属于当前类型，未知问题无可支持fact时不应强填字段。明确针对原响应的最小方案后再施工；不放宽schema、不挪正引用、不把question强塞fact、不靠固定页数强迫双类型。两型质量覆盖缺口另按原始资料主题证据裁定，不能自动当作主题算法缺陷。

本轮到此停止。真实复验应待必要工程修复与独立审查完成后另定，旧失败原样保留；本报告不授权新施工或消费247。
