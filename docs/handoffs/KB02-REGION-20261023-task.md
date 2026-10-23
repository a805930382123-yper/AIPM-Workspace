# KB02 区域语义归属返修（A模式）

用户已授权Sol诊断、Astra确认根因与模式、对应Agent施工自查及Astra独立验收全闭环。[Sol诊断](../reports/KB02-REGION-DIAG-20261023-diagnosis.md)及[Astra正式裁定](../reports/KB02-REGION-AUDIT-20261023-review.md)已完成。评分需求0/耦合1/风险1/历史2=4，A模式，Sol先审本卡、Luna施工、本轮Astra最终独立验收。HEAD5be0602，产品a836270。

## 缺陷与目标

F-KB02-FIELDS-LONG-01/P1：seq180输入14/14区域上下文充分且已有总则，原响应将27边界unit（25事实/21问题）合入泛化未知/未来页面，55unit/100ID机械完整而主体归属错误。expand与组装忠实沿用响应。模型内部原因未证实，禁止以15页本身判失败或把本次当旧unit分裂复发。

目标是有界改善规划决策：先识别本unit明确主体/时间/条件/口径，再判独立主题，将未知/否定/未来边界归属相关事实主题，最后同一次响应内反查标题/成员主体。抽象正反例覆盖不同主体同句各归属、同主体同口径跨chunk可合并、原文独立AI机制可建页。不固定页数/一主体一页，不按未知/未来关键词过滤，不改写事实。跨栏unit仍独立，仅在同主题边界时应归同承载页。真实原例仍须实测，不能把提示改动称根治。

## 范围与所有权

Luna仅修改2产品文件：services/llm/knowledge-planning.ts中的KNOWLEDGE_PLANNING_INSTRUCTION，services/llm/rules.ts的KB02_PROMPT_REVISION 10→11。不得修改build/expand/project、unit/source/schema、Provider、UI、持久结构/兼容策略、预算/自动重试或依赖。必要扩围先由主Agent/Astra裁定。

默认测试仅允许7文件的必要当前revision断言迁移：llm、kb02-extraction-contract、kb02-classification-priority、kb02-final-classification、kb02-planning-context、kb02-edge-extraction、kb02-planning-fields；保留真正旧版本夹具含义。新增tests/kb02-planning-attribution.test.ts及隔离虚构fixture，覆盖实际pipeline指令与恢复门禁；不删旧断言，不把fake正例签为真实语义PASS。

Luna拥有上述产品/tests与新KB02-REGION-20261023前缀施工报告/脚本；Sol诊断前缀KB02-REGION-DIAG-20261023只读保留，计划审查另用KB02-REGION-PLAN-20261023前缀；Astra拥有KB02-REGION-AUDIT-20261023独立资产；主Agent拥有本卡/status/agent-control/Git。非独占工作区，不撤销别人修改。已有3份预检规则未提交增量保持。正式workspace/config/.env.local、历史报告/脚本禁止改写。

## 必要自查与验收

施工按清单逐项自查、局部修复并报告实际命令、失败与最终结果、scope/frozen/handoff，之后停写。会写历史证据的测试必须在字节一致隔离副本运行，保留每次独立stdout，避免覆盖首败记录。

必须验证新增指令决策步骤与抽象正反例实际进入planning system、全部原ID/unit保留、原seq180错误响应仍机械可接受但语义负例明确、人工正确fixture只证明可表达；revision10旧未完成409/保字节/零调用、显式restart重提取、旧已完成草稿可读；规划fields/context/budget、提取/分类/恢复/秘密/预算取消/HTTP/更新相关回归。最终同冻结默认完整0skip、tsc/Vite、旧Node24受影响及SR01、历史独立probe保留执行。旧报告保护摘要和正式数据/配置保持。

Astra冻结后独立读diff/实际代码、复跑必要工程及边界检查，通过后主Agent放行真实验收：原短文2次→Chrome确认原指标与人工备注→原106400字符长文15次→补充2次→候选明确选旧目标/更新预览1次。预估20次。逐页核全部ID/unit、区域数值日期、边界主体归属、独立业务主题依据，不固定14页。实际Chrome审核、刷新/持久回读，更新双方支持、20%/30%冲突、人工备注/双Raw、显式确认及幂等必测。

用户总额已提升500，累计183，本轮阶段最多24，Prompt15/24独立不变；施工与诊断真实0，工程前不外发，所有尝试事前记账，无自动重试。余4仅有明确用途才放行。最终分别裁定本轮缺陷修复与KB02整体；必要门槛未过不能PASS或推进依赖批次。若同核心真实失败，停止叠加提示和盲试，由Astra重规划；若扩大跨模块协议/完整性机制须重评B。主Agent统一状态、提交同步并补实际代码提交关联，汇报后不自动启动下一批。
