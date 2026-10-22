# KB02 规划字段职责返修（A模式）

用户明确确认实施当前KB02，沿用Astra已确认[最小方案](../reports/KB02-TYPE-AUDIT-20261022-review.md)：Sol先审计划，Luna施工/自查，冻结后Sol独立验收，补齐真实更新链；主Agent统一状态、提交同步，不启动下一批。

## 目标与边界

Sol[计划审查已通过](../reports/KB02-FIELDS-AUDIT-20261022-plan-review.md)，主Agent已明确放行 `/root/luna_builder`（GPT-6 Luna High）按本卡施工；`/root/sol_repair`（GPT-6.1 Sol High）本轮仅审查与独立验收，不施工产品。旧revision8/9兼容夹具不得全局替换，新增说明与示例不得改变实际响应语义或校验。

F-KB02-EDGE-PLAN-01/P1：seq148将category合法值ai_application误填type，严格拒绝导致短文无草稿，更新链依赖失败。现schema/发送枚举/适配器正确，不改写模型返回、不放宽schema、不自动重试，不将提示候选视为已证实根治。

基线HEAD ea36a52（对应产品420e123）。施工前缀KB02-FIELDS-20261022；独立前缀KB02-FIELDS-AUDIT-20261022。Sol只计划审查/独立验收，禁止产品/default tests施工；Luna仅批准产品/tests及施工资产。主Agent拥有本卡、status/agent-control/Git。历史资产、正式workspace/config/密钥不改；搜索旁支不纳入。

产品仅2文件：services/llm/knowledge-extraction.ts的规划system构造，services/llm/rules.ts revision9→10。type解释知识形态、category解释业务主题；枚举及说明取当前严格schema/FMCG定义，合法配对示例须与当前枚举一致。metric/metric和concept/ai_application用于解释独立维度，不强制AI主题总用concept，不引用seq148专用Raw/ID。

施工期间补充裁定：新system构造/秘密预检必须在规划状态写入和beforeCall计数之前，拒绝不增加attempt；规划输入192KiB既有定义不变。新system读取FMCG label/description，故rules.ts须将fmcgText纳入revision10指纹，防止标签/描述变化后静默复用旧checkpoint；在临时rules副本验证指纹变化与旧记录拒绝。此为本轮新动态来源必要兼容绑定，仍限上述2产品文件，不改变存储/Provider协议。

测试仅6个实际必要revision适配文件：llm、kb02-extraction-contract、kb02-classification-priority、kb02-final-classification、kb02-planning-context、kb02-edge-extraction；新增tests/kb02-planning-fields.test.ts。旧revision兼容用例保留真实旧含义，历史夹具/证据不改；额外文件先说明。不得改提取atom、unit协议、Provider、schema、存储、预算/重试、UI或依赖。

## 门槛与交接

原seq148严格拒绝、提取/Raw不变无草稿；动态枚举/配对示例一致；非法互换与合法交叉、unit完整及同源归属；坏持久plan、revision9旧未完成409零写入、显式restart、旧完成草稿；普通继续与planningRetry差异、安全/192KiB/预算/取消恢复；默认完整0skip、tsc/Vite、旧Node及历史独立probe。施工逐项自查、局部修复、保存首败与最终结果，交scope/frozen/handoff后停写，不自签通过。

Sol独立检查实际差异/原验收标准/真实命令证据，不能只采施工自查。真实原短文2→Chrome确认metric并人工备注→原106400字符14段+规划15→补充2→选旧目标/更新预览1，语义、20%/30%冲突、共同观点双侧支持、双来源、原文与人工备注核对后显式确认/刷新持久回读；原长文质量和所有ID/区域数值不可由旧版证据代签。

用户已授权隔离虚构资料到open.bigmodel.cn及Playwright真实Chrome。真实累计163/200，Prompt15/24，本轮阶段上限24（最多187，必要估算20）；工程冻结且独立通过后另行放行。施工真实0，所有尝试事前记账，余量不自动重试，同核心修复后失败停试并重新裁定。旧阶段余7已封账，不迁移或重置累计。

每轮报告附实际命令、结果摘要、代码提交或冻结关联标识；必须分别裁决本轮缺陷修复与KB02整体门槛。未满足任一必需门槛不得整体通过。完成后主Agent统一提交，补明提交标识，汇报并等待下一步确认。
