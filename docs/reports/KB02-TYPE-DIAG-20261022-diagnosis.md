# seq148 规划type/category离线诊断

**已证实失败来自原响应的单一type枚举错误，未发现枚举发送错误或服务端字段改写。当前没有修复，F-KB02-EDGE-PLAN-01仍未关闭，KB02整体未通过。** 本轮仅诊断，产品/default tests未改，网络及真实模型调用0，累计163/200、Prompt15/24不变；不决定A/B、不启动施工。

被诊断HEAD：`b852904d3cacbb97205f57d425e0746cf47c802d`；产品代码提交：`420e123997c9fffc179af7bf32bd361ed341b9a9`。已实际检查两者间services/rules/app无差异。依据本轮AGENTS验收分层要求，诊断成立与修复成功、批次通过分别处理；前轮空白/UI关闭结论不由本诊断重开，搜索旁支不纳范围。

## 已证实机制

| 环节 | 本轮证据 |
|---|---|
| 原请求与枚举 | 原trace seq148、short-failure证据及当前规则逐字核对：嵌入schema等于服务端schema，type=`concept/entity/business_process/metric`，category允许`ai_application`；两组枚举均与FMCG定义一致。4事实unit、1问题unit与原提取checkpoint重建输入完全一致。 |
| 原响应 | HTTP200/stop，第二页把`ai_application`同时写入type和category；单一错误正是`$.pages[1].type`枚举错误。unit未知/重复/遗漏与标题重复均空，不能把此例归为覆盖缺失。 |
| Provider模式与改写 | 当前适配器以相同虚构配置、内存fetch拦截发出与原trace完全相同的wire；`temperature:0`、`reasoning_effort:low`、`response_format:{type:json_object}`。schema只在system文本中，wire未发送json_schema约束。适配器返回原content文本逐字不变，没有type/category映射。此拦截未调用原生fetch。 |
| 管道校验 | 使用原提取checkpoint/请求/响应，精确重放LLM_SCHEMA_INVALID；严格schema先于unit展开、持久plan与草稿组装。提取记录保持不变，无plan；单次显式调用只做1次规划，本地attempts由2→3，无自动重试。 |
| 持久恢复校验 | 同规则坏type持久plan被409 LLM_CHECKPOINT_CORRUPT拒绝；规则不兼容在写入/调用前409。十组字段反例确认category合法不代表type合法，source/synthesis/bogus均未被默许。 |

完整数据：[replay.json](KB02-TYPE-DIAG-20261022-replay.json)。把**测试夹具**的非法type改成合法`concept`后，schema/管道/无损持久投影通过，说明观察到的结构阻断点可局限到这一字段；这是带标签的反事实对照，既不是产品修补，也没有证明该类型在业务语义上最优。

## 恢复语义

[实际Runner离线重放](KB02-TYPE-DIAG-20261022-recovery.json)仅在自有临时目录保存虚构Raw，保持原文本/规则/规划响应，重绑定隔离Raw/job/evidence身份和fake Provider。

- `{planningRetry:true}` 专用入口仅接受完整提取且带coverage diagnostic的LLM_PLAN_COVERAGE_INVALID；本例是LLM_SCHEMA_INVALID，准确返回409 LLM_PLANNING_RETRY_UNAVAILABLE，Provider增量0，job/cp/raw-state三文件字节不变。
- 普通显式继续 `{}` 使用同job和已验证提取块，只增加1次规划、失败仍严格保留，无草稿。第二次明确调用同样只增1次，累计2→3→4；没有自动补发，也没有重做提取。API `reused:false` 表示本次启动执行，不代表未复用提取块，不能用该标志替代job/chunks/attempt证明。
- 规则不兼容的普通继续409，三文件字节不变、Provider增量0。若未来改Prompt/revision，不能悄悄把旧提取记录重绑定新规则；仍须既有显式restart，旧完成草稿兼容另做回归。

## 尚不能证明的原因

当前规划指令集中解释unit/覆盖，type与category只有schema枚举，缺少独立字段语义及合法配对示例，这是可核查的提示边界缺口。**不能从一次响应证明模型内部注意力、AI主题词诱导或“复制category到type”是唯一原因；也不能声称temperature0/json_object会保证枚举正确。** 本轮没有真实模型对照实验，不给Prompt改动成功率或根治承诺。未检验供应商是否支持特定json_schema模式，不能把它当现成可用修复。

## 最小修复候选（待Astra确认与另行授权）

优先候选仅明确规划字段职责：type描述页面知识形态，category描述业务主题；分别从当前严格schema/FMCG定义生成枚举/说明，并给内容无关的合法配对示例（包括同值metric/metric与不同值concept/ai_application）。不得把AI主题一律映射为某种type，不引用seq148专用Raw/ID，不放宽schema、改写返回值、自动重试或增加Provider调用。

预期产品影响仅 `services/llm/knowledge-extraction.ts` 的规划system构造和 `services/llm/rules.ts` revision9→10。atom提取、unit输入/wire v3/持久结构、Provider、存储、UI不变；旧未完成checkpoint409、显式restart及旧完成草稿规则保持。若采用共享helper或其它文件，须Astra另裁范围。改Provider为结构化schema输出是更大替代方案，牵涉供应商能力、共享六链兼容，不作为本例首选。

必要测试候选：新规划字段回归入口＋现有5处revision断言必要迁移；原seq148严格拒绝/原提取不变/无草稿、动态枚举与示例自校验、type/category交换及合法交叉组合、普通继续与专用入口区别、当前坏持久plan/旧规则409/显式restart/旧完成草稿、unit全覆盖/同源归属/秘密/192KiB/预算取消、默认完整/tsc/Vite/旧Node/历史probe。Prompt发生变化后，原短文与14区域规划质量、补充更新完整Chrome链仍须独立真实验证，不能拿本轮离线通过或上轮真实长文代签。额度与阶段上限另由主Agent裁定，剩37不是重试许可。

## 四维风险证据（供Astra重评分，不先锁模式）

| 维度 | 建议分 | 原因 |
|---|---:|---|
| 需求明确度 | 0 | 两个字段及严格拒绝标准明确，不存在应允许ai_application作为type的需求歧义。 |
| 模块耦合度 | 1 | 最小候选跨规划Prompt与规则指纹/恢复兼容，尚不改Provider或持久结构。 |
| 修改风险 | 1 | 局部提示变化，但影响所有规划输出及旧未完成任务兼容；须真实长文/更新链回归。 |
| 历史失败 | 1 | 此type/category缺陷首次被实测，尚未针对该缺陷修复后复发；不能把空白、覆盖、同源等不同核心缺陷算作类型返修复发。规划链多轮质量失败仍是审查背景。 |

精准缺陷建议总分3/8；此前按广义规划质量历史给4/8的背景仍保留。最终分数、A/B模式及是否开工由Astra/主Agent依据本报告裁定。

## 实际命令、失败及保护

1. `node tests/acceptance/KB02-TYPE-DIAG-20261022-baseline.mjs`：exit0，100产品、76测试支持、3217保护文件、62正式workspace文件、5配置指纹。
2. `node --import tsx tests/acceptance/KB02-TYPE-DIAG-20261022-replay.mjs`：exit0，原wire/响应/枚举/单错误、适配器逐字、10反例、管道及恢复校验全部通过。
3. `node --import tsx tests/acceptance/KB02-TYPE-DIAG-20261022-recovery.mjs`：最终exit0，普通继续/专用入口/不兼容门禁实测通过。首跑脚本误假设API reused=true而失败，按真实代码语义改为false，并分开证明提取复用；[首败记录](KB02-TYPE-DIAG-20261022-probe-first-failure.json)保留，无产品修改。
4. `node tests/acceptance/KB02-TYPE-DIAG-20261022-integrity.mjs`：核对产品/default tests、正式workspace/config与历史保护；结果见[integrity.json](KB02-TYPE-DIAG-20261022-integrity.json)。

本轮未跑无变更的完整工程/真实验收，不新增修复PASS。诊断资产只写本前缀；主Agent负责状态、Git和后续裁定。
